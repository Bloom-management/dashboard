import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hash, normalize } from '../../src/server/calendar/normalize';
import { planReconciliation, type State } from '../../src/server/calendar/reconcile';
import type { Event, Snapshot } from '../../src/server/calendar/types';

const initial = normalize(readFileSync('tests/calendar/fixtures/airbnb.ics', 'utf8'), 'airbnb', 'America/Detroit');
const run = (state: State, snapshot = initial) => planReconciliation(state, 'source-a', snapshot, 'America/Detroit');
const fresh = () => run({ events: [], jobs: [], notices: [] }).state;
function classification(kind: 'unknown' | 'blocked', endDate = initial.events[0].endDate): Snapshot {
  const { contentHash: _, ...original } = initial.events[0];
  const data = { ...original, endDate, kind, reviewRequired: true, evidence: kind === 'blocked' ? 'observed-block' : 'unverified' } as const;
  return { ...initial, events: [{ ...data, contentHash: hash(data) }] };
}
function movedReservation(): Snapshot {
  const { contentHash: _, ...original } = initial.events[0];
  const data = { ...original, endDate: '2026-11-02' };
  return { ...initial, events: [{ ...data, contentHash: hash(data) }] };
}

test('reservation reclassification holds existing unclaimed/claimed jobs; completed history stays immutable', () => {
  for (const kind of ['unknown', 'blocked'] as const) {
    for (const mode of ['unclaimed', 'claimed', 'completed'] as const) {
      const before = fresh();
      before.jobs[0].claimed = mode === 'claimed';
      if (mode === 'completed') before.jobs[0].status = 'completed';
      const result = run(before, classification(kind, '2026-11-02'));
      assert.equal(result.state.jobs.length, 1);
      assert.deepEqual(result.state.jobs[0], { ...before.jobs[0], reviewRequired: mode !== 'completed' });
      assert.equal(result.effects[0].action, mode === 'completed' ? 'append_completed_warning' : 'hold_for_admin');
      const replay = run(result.state, classification(kind, '2026-11-02'));
      assert.deepEqual(replay.state, result.state);
      assert.deepEqual(replay.effects, []);
    }
  }
});

test('review hold survives later positive reservation evidence and date changes until explicit admin resolution', () => {
  for (const kind of ['unknown', 'blocked'] as const) {
    const held = run(fresh(), classification(kind)).state;
    const recovered = run(held, movedReservation());
    assert.deepEqual(recovered.state.jobs, held.jobs);
    assert.equal(recovered.state.jobs.length, 1);
    assert.equal(recovered.effects[0].action, 'hold_for_admin');
    assert.deepEqual(run(recovered.state, movedReservation()).effects, []);
  }
});

test('mixed snapshots preserve unrelated positively identified reservation turnover', () => {
  const unknown = classification('unknown').events[0];
  const data = { ...unknown, uid: 'synthetic-unrelated@airbnb.com', startDate: '2026-12-01', endDate: '2026-12-04' };
  const event: Event = { ...data, contentHash: hash(data) };
  const mixed = { ...initial, events: [...initial.events, event] };
  const result = run({ events: [], jobs: [], notices: [] }, mixed);
  assert.equal(result.state.events.length, 2);
  assert.equal(result.state.jobs.length, 1);
  assert.equal(result.state.jobs[0].reviewRequired, false);
  assert.equal(result.state.notices.length, 1);
  assert.deepEqual(run(result.state, mixed).effects, []);
});

test('reservation kind without positive evidence or with review flag never creates a job', () => {
  for (const patch of [{ evidence: 'unverified' as const }, { reviewRequired: true }]) {
    const data = { ...initial.events[0], ...patch };
    const snapshot = { ...initial, events: [{ ...data, contentHash: hash(data) }] };
    assert.equal(run({ events: [], jobs: [], notices: [] }, snapshot).state.jobs.length, 0);
    const held = run(fresh(), snapshot);
    assert.equal(held.state.jobs[0].reviewRequired, true);
    assert.equal(held.state.jobs.length, 1);
  }
});

test('nonidentical unknown occupancy overlapping a reservation holds its turnover without creating another', () => {
  const data = { ...classification('unknown').events[0], uid: 'synthetic-overlap@airbnb.com', endDate: '2026-11-02' };
  const mixed = { ...initial, events: [...initial.events, { ...data, contentHash: hash(data) }] };
  const result = run({ events: [], jobs: [], notices: [] }, mixed);
  assert.equal(result.state.jobs.length, 1);
  assert.equal(result.state.jobs[0].reviewRequired, true);
  assert.deepEqual(run(result.state, mixed).effects, []);
});

test('nonidentical same-checkout reservations produce one held turnover', () => {
  const data = { ...initial.events[0], uid: 'synthetic-shared-checkout@airbnb.com', startDate: '2026-10-29' };
  const mixed = { ...initial, events: [...initial.events, { ...data, contentHash: hash(data) }] };
  const result = run({ events: [], jobs: [], notices: [] }, mixed);
  assert.equal(result.state.jobs.length, 1);
  assert.equal(result.state.jobs[0].eventKeys.length, 2);
  assert.equal(result.state.jobs[0].reviewRequired, true);
});
