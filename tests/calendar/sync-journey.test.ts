import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CalendarService } from '../../src/server/calendar/service';
import { protectUrl } from '../../src/server/calendar/secrets';
import { validateUrl } from '../../src/server/calendar/fetch';
import { CalendarError } from '../../src/server/calendar/errors';
import { planReconciliation, type State } from '../../src/server/calendar/reconcile';
import type { CalendarStore, Lease, Snapshot } from '../../src/server/calendar/types';
const mixed = readFileSync('tests/calendar/fixtures/airbnb-mixed.ics', 'utf8');
const zone = 'America/Detroit';
test('service forwards the complete mixed snapshot, preserving unknown occupancy; reference planner creates only the confirmed checkout', async () => {
  const saved = process.env.CALENDAR_ENCRYPTION_KEY; process.env.CALENDAR_ENCRYPTION_KEY = 'ab'.repeat(32);
  let state: State = { events: [], jobs: [], notices: [] }; let last: Snapshot | undefined;
  const lease: Lease = { runId: 'synthetic', version: 1, source: { id: 'source', propertyId: 'property', provider: 'airbnb', timezone: zone,
    enabled: true, syncVersion: 1, ...protectUrl('https://www.airbnb.com/calendar/ical/1.ics?t=synthetic', 'airbnb', 'property') } };
  // This is a reference-store test, not a claim about PostgreSQL persistence or its policy migration.
  const store = { beginSync: async () => lease, failSync: async () => assert.fail('Valid mixed snapshot is not a partial feed'),
    finishSync: async (_lease: Lease, snapshot: Snapshot) => {
      assert.equal(snapshot.events.length, 2); assert.equal(snapshot.complete, true); last = snapshot;
      const next = planReconciliation(state, 'source', snapshot, zone); state = next.state;
      return { runId: lease.runId, status: 'success', created: next.effects.filter(e => e.action === 'create_turnover').length, updated: 0, removed: 0, unchanged: 0, conflicts: 0 };
    } } as unknown as CalendarStore;
  try {
    const service = new CalendarService(store, async () => ({ status: 200, body: mixed }));
    assert.equal((await service.sync('source', 'one', { propertyId: 'property' })).created, 1);
    const prior = structuredClone(state);
    assert.equal((await service.sync('source', 'two', { propertyId: 'property' })).created, 0); assert.deepEqual(state, prior);
    assert.equal(last!.events[1].kind, 'unknown'); assert.equal(last!.events[1].reviewRequired, true);
    assert.equal(state.events.length, 2); assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].checkoutDate, '2026-11-09'); // Exclusive end, not the last occupied night.
    assert.equal(state.jobs[0].startAt, '2026-11-09T16:00:00.000Z'); assert.equal(state.jobs[0].endAt, '2026-11-09T20:00:00.000Z');
  } finally { if (saved === undefined) delete process.env.CALENDAR_ENCRYPTION_KEY; else process.env.CALENDAR_ENCRYPTION_KEY = saved; }
});
test('lease target/provider mismatch fails before URL decryption or fetch', async () => {
  for (const expected of [{ propertyId: 'wrong' }, { provider: 'airbnb' as const }]) {
    let failed = false;
    const store = { beginSync: async () => ({ runId:'r', version:1, source: { id:'s', propertyId:'p', provider:'vrbo', enabled:true, encryptedUrl:'invalid' } }),
      failSync: async () => { failed = true; } } as unknown as CalendarStore;
    await assert.rejects(new CalendarService(store, async () => assert.fail('Must not fetch')).sync('s','key',expected)); assert(failed);
  }
});
test('bookkeeping failure cannot mask the original safe fetch error', async () => {
  const saved = process.env.CALENDAR_ENCRYPTION_KEY; process.env.CALENDAR_ENCRYPTION_KEY = 'ab'.repeat(32);
  try {
    const store = { beginSync: async () => ({ runId:'r', version:1, source: { id:'s', propertyId:'p', provider:'airbnb', enabled:true, ...protectUrl('https://www.airbnb.com/calendar/ical/1.ics', 'airbnb','p') } }),
      failSync: async () => { throw new Error('private transport material'); } } as unknown as CalendarStore;
    await assert.rejects(new CalendarService(store, async () => { throw new CalendarError('FETCH_TIMEOUT'); }).sync('s','key'), { code:'FETCH_TIMEOUT', message:'FETCH_TIMEOUT' });
  } finally { if (saved === undefined) delete process.env.CALENDAR_ENCRYPTION_KEY; else process.env.CALENDAR_ENCRYPTION_KEY = saved; }
});
test('Airbnb listing pages cannot be saved as export links', () => {
  assert.throws(() => validateUrl('https://www.airbnb.com/rooms/123456', 'airbnb'), { code:'UNSAFE_URL' });
  assert.equal(validateUrl('https://www.airbnb.com/calendar/ical/1.ics?t=synthetic', 'airbnb').hostname, 'www.airbnb.com');
});
