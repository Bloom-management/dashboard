import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize, cleaningWindow } from '../../src/server/calendar/normalize';
import { planReconciliation, type State } from '../../src/server/calendar/reconcile';
import { protectUrl, revealUrl } from '../../src/server/calendar/secrets';
import { publicAddress, validateUrl } from '../../src/server/calendar/fetch';
import { authenticateSchedule, calendarResponse } from '../../src/server/calendar/http';
import { CalendarService } from '../../src/server/calendar/service';
import { CalendarError } from '../../src/server/calendar/errors';
import { ownerBlocks } from '../../src/server/calendar/owner';
import type { CalendarStore, Lease } from '../../src/server/calendar/types';
const airbnb = readFileSync('tests/calendar/fixtures/airbnb.ics', 'utf8');
const vrbo = readFileSync('tests/calendar/fixtures/vrbo.ics', 'utf8');
const parse = (text = airbnb) => normalize(text, 'airbnb', 'America/Detroit');
const empty = (): State => ({ events: [], jobs: [], notices: [] });
const plan = (state = empty(), text = airbnb) => planReconciliation(state, 'source-a', parse(text), 'America/Detroit');
const cancelled = airbnb.replace('SUMMARY:Reserved', 'SUMMARY:Reserved\nSTATUS:CANCELLED');
const moved = airbnb.replace('20261101', '20261102');
const noEvents = 'BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR';
test('live-pattern synthetic fixture: folded descriptions, reservation evidence, exclusive checkout', () => {
  const snapshot = parse(); assert.equal(snapshot.complete, true); assert.equal(snapshot.events[0].kind, 'reservation');
  assert.equal(snapshot.events[0].endDate, '2026-11-01'); assert.equal(plan().state.jobs[0].checkoutDate, '2026-11-01');
});
test('repeated sync is a no-op; DTSTAMP changes are not booking changes', () => {
  const first = plan(); const second = plan(first.state);
  assert.deepEqual(second.state, first.state); assert.deepEqual(second.effects, []);
  assert.deepEqual(plan(first.state, airbnb.replace('20260912T000000Z', '20260913T000000Z')).state, first.state);
});
test('unclaimed checkout changes cancel old turnover and create new with history effects', () => {
  const changed = plan(plan().state, moved);
  assert.equal(changed.state.jobs.filter(j => j.status === 'open').length, 1);
  assert.equal(changed.state.jobs.find(j => j.status === 'open')!.checkoutDate, '2026-11-02');
  assert.equal(changed.state.jobs[0].status, 'cancelled'); assert.equal(changed.state.notices[0].type, 'changed');
});
test('explicit cancellation cancels unclaimed job; repeated cancellation does nothing', () => {
  const changed = plan(plan().state, cancelled); assert.equal(changed.state.jobs[0].status, 'cancelled');
  assert.deepEqual(plan(changed.state, cancelled).effects, []);
});
test('disappearance preserves turnover on hold and visible tombstone because coverage is unknown', () => {
  const changed = plan(plan().state, noEvents);
  assert.equal(changed.state.events[0].removed, true); assert.equal(changed.state.events[0].missing, true);
  assert.equal(changed.state.jobs[0].status, 'open'); assert.equal(changed.state.jobs[0].reviewRequired, true);
  assert.deepEqual(plan(changed.state, noEvents).state, changed.state);
});
test('claimed changes/cancellation preserve schedule and assignment; no speculative replacement', () => {
  for (const text of [moved, cancelled, noEvents]) {
    const state = plan().state; state.jobs[0].claimed = true;
    const next = plan(state, text); assert.equal(next.state.jobs.length, 1);
    assert.equal(next.state.jobs[0].checkoutDate, '2026-11-01'); assert.equal(next.state.jobs[0].claimed, true);
    assert.equal(next.state.jobs[0].reviewRequired, true);
  }
});
test('completed rows immutable, including changed UID on same date', () => {
  for (const text of [moved, cancelled, noEvents, airbnb.replace('synthetic-reservation@', 'new-uid@')]) {
    const state = plan().state; state.jobs[0].status = 'completed';
    const next = plan(state, text); assert.deepEqual(next.state.jobs, state.jobs);
    assert(next.effects.some(e => e.action === 'append_completed_warning'));
    assert.deepEqual(plan(next.state, text).effects, []);
  }
});
test('blocked and ambiguous events produce review blocks, no cleaning', () => {
  const snapshot = normalize(vrbo, 'vrbo', 'America/Detroit'); assert.equal(snapshot.events[0].kind, 'blocked');
  const result = planReconciliation(empty(), 'source-v', snapshot, 'America/Detroit');
  assert.equal(result.state.jobs.length, 0); assert.equal(result.state.notices.length, 1);
  const unknown = plan(empty(), airbnb.replace('SUMMARY:Reserved', 'SUMMARY:Unavailable')); assert.equal(unknown.state.jobs.length, 0);
});
test('identical periods across feeds preserve separate identities without manufacturing conflict', () => {
  const first = plan().state;
  const result = planReconciliation(first, 'source-b', parse(), 'America/Detroit');
  assert.equal(result.state.events.length, 2); assert.equal(result.state.jobs.length, 1);
  assert.equal(result.state.jobs[0].eventKeys.length, 2); assert.equal(result.state.jobs[0].reviewRequired, false);
});
test('identical duplicate UID collapses; conflicting duplicate invalidates snapshot', () => {
  const event = airbnb.slice(airbnb.indexOf('BEGIN:VEVENT'), airbnb.indexOf('END:VEVENT') + 10);
  assert.equal(parse(airbnb.replace('END:VCALENDAR', event + '\nEND:VCALENDAR')).events.length, 1);
  const bad = parse(airbnb.replace('END:VCALENDAR', event.replace('20261101', '20261102') + '\nEND:VCALENDAR'));
  assert.equal(bad.complete, false); assert.equal(bad.events.length, 0);
});
test('malformed/truncated events and unsupported recurrences cannot reconcile away prior jobs', () => {
  assert.throws(() => parse(airbnb.replace('END:VCALENDAR', '')));
  for (const text of [airbnb.replace('20261101', '20261340'), airbnb.replace('UID:synthetic-reservation@airbnb.com', ''), airbnb.replace('SUMMARY:Reserved', 'RRULE:FREQ=DAILY\nSUMMARY:Reserved')]) {
    const snapshot = parse(text); assert.equal(snapshot.complete, false);
    const state = plan().state; assert.deepEqual(planReconciliation(state, 'source-a', snapshot, 'America/Detroit').state, state);
  }
});
test('DST spring and fall: 11–15 local are converted independently', () => {
  assert.deepEqual(cleaningWindow('2026-03-08', 'America/Detroit'), { startAt: '2026-03-08T15:00:00.000Z', endAt: '2026-03-08T19:00:00.000Z' });
  assert.deepEqual(cleaningWindow('2026-11-01', 'America/Detroit'), { startAt: '2026-11-01T16:00:00.000Z', endAt: '2026-11-01T20:00:00.000Z' });
});
test('UTC, floating and IANA timed endpoints use property dates; ambiguous DST refused', () => {
  const timed = airbnb.replace('DTSTART;VALUE=DATE:20261030', 'DTSTART:20261030T200000Z').replace('DTEND;VALUE=DATE:20261101', 'DTEND:20261102T020000Z');
  assert.equal(parse(timed).events[0].endDate, '2026-11-01');
  assert.equal(parse(timed.replace('DTEND:20261102T020000Z', 'DTEND;TZID=America/Detroit:20261102T110000')).events[0].endDate, '2026-11-02');
  assert.equal(parse(timed.replace('DTEND:20261102T020000Z', 'DTEND:20261102T110000')).events[0].endDate, '2026-11-02');
  assert.equal(parse(timed.replace('DTEND:20261102T020000Z', 'DTEND;TZID=America/Detroit:20261101T013000')).complete, false);
});
test('URL allowlist and public address restrictions', () => {
  for (const url of ['http://www.airbnb.com/calendar/ical/1.ics','https://www.airbnb.com.evil.test/calendar/ical/1.ics','https://user:pass@www.airbnb.com/calendar/ical/1.ics','https://127.0.0.1/calendar/ical/1.ics','https://www.airbnb.com:444/calendar/ical/1.ics']) assert.throws(() => validateUrl(url, 'airbnb'));
  for (const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','::1','fc00::1','fe80::1','::ffff:127.0.0.1','192.0.2.1','100.64.0.1','224.0.0.1']) assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('8.8.8.8'), true);
});
test('encryption binds property/provider; stable identity survives token rotation', () => {
  process.env.CALENDAR_ENCRYPTION_KEY = 'ab'.repeat(32);
  const url = 'https://www.airbnb.com/calendar/ical/1.ics?t=synthetic';
  const secret = protectUrl(url, 'airbnb', 'property-a');
  assert(!secret.encryptedUrl.includes('synthetic')); assert.equal(revealUrl(secret.encryptedUrl, 'airbnb', 'property-a'), url);
  assert.throws(() => revealUrl(secret.encryptedUrl, 'airbnb', 'property-b'));
  assert.equal(secret.fingerprint, protectUrl(url + '2', 'airbnb', 'property-a').fingerprint);
});
test('scheduler auth fails closed and errors never echo upstream secrets', async () => {
  delete process.env.CALENDAR_SYNC_SECRET; assert.throws(() => authenticateSchedule(new Request('https://bloom.test')));
  process.env.CALENDAR_SYNC_SECRET = 'x'.repeat(32);
  assert.throws(() => authenticateSchedule(new Request('https://bloom.test', { headers: { authorization: 'Bearer wrong' } })));
  authenticateSchedule(new Request('https://bloom.test', { headers: { authorization: `Bearer ${'x'.repeat(32)}` } }));
  const result = await calendarResponse(async () => { throw new Error('https://private-feed?token=secret'); });
  assert(!(await result.text()).includes('secret'));
});
test('service failures never call reconciliation; 304 has no event snapshot; retries use lease version', async () => {
  process.env.CALENDAR_ENCRYPTION_KEY = 'ab'.repeat(32);
  const lease: Lease = { runId: 'run', version: 2, source: { id:'s', propertyId:'p', provider:'airbnb', timezone:'America/Detroit', enabled:true, syncVersion:1, etag:'"abc"', ...protectUrl('https://www.airbnb.com/calendar/ical/1.ics', 'airbnb', 'p') } };
  let finished = 0, failed = 0;
  const store = { beginSync: async () => lease, failSync: async () => { failed++; }, finishSync: async (l: Lease, snapshot: unknown) => { finished++; assert.equal(l.version, 2); assert.equal(snapshot, null); return { runId:'run',created:0,updated:0,removed:0,unchanged:1,conflicts:0 }; } } as unknown as CalendarStore;
  await assert.rejects(new CalendarService(store, async () => { throw new CalendarError('FETCH_TIMEOUT'); }).sync('s','k'));
  assert.equal(finished, 0); assert.equal(failed, 1);
  await new CalendarService(store, async () => ({ status:304 })).sync('s','k2'); assert.equal(finished, 1);
});
test('owner projection strips raw URLs, names of cleaners, pricing and source UID', () => {
  const input = { id:'e', propertyId:'p', propertyName:'Unit', timezone:'America/Detroit', startDate:'2026-10-30', endDate:'2026-11-01', provider:'airbnb' as const, kind:'reservation' as const, removed:false, changes:[], encryptedUrl:'secret', cleanerId:'secret', uid:'secret', price:42 };
  const output = JSON.stringify(ownerBlocks([input])); assert(!output.includes('secret')); assert(!output.includes('42'));
});
test('unsupported calendar methods, embedded timezone definitions and tentative stays require review', () => {
  assert.equal(parse(airbnb.replace('VERSION:2.0', 'VERSION:2.0\nMETHOD:CANCEL')).complete, false);
  assert.equal(parse(airbnb.replace('BEGIN:VEVENT', 'BEGIN:VTIMEZONE\nTZID:Custom\nEND:VTIMEZONE\nBEGIN:VEVENT')).complete, false);
  assert.equal(plan(empty(), airbnb.replace('SUMMARY:Reserved', 'SUMMARY:Reserved\nSTATUS:TENTATIVE')).state.jobs.length, 0);
});
