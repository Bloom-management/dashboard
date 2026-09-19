import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateOwnerPerformance as calculate } from '../../src/server/calendar/owner-metrics';
import type { OwnerAnalyticsInput, OwnerNightEvent } from '../../src/contracts/owner-hub';
const from = '2026-03-07', to = '2026-03-11';
const property = (id = 'a', complete = false) => ({ id, name: id, timezone: 'America/Detroit', coverage: complete ? [{ from, toExclusive: to }] : [] });
const event = (patch: Partial<OwnerNightEvent> = {}): OwnerNightEvent => ({ id: 'stay', propertyId: 'a', startDate: from, endDate: '2026-03-09', kind: 'reservation', confirmed: true, removed: false, origin: 'airbnb', ...patch });
const run = (events: OwnerNightEvent[], complete = false) => calculate({ properties: [property('a', complete)], events }, from, to);

test('unknown coverage reports known nights without inventing occupancy or available nights', () => {
  const result = run([event()]).totals;
  assert.equal(result.bookedNights, 2); assert.equal(result.checkIns, 1);
  assert.equal(result.occupancy, null); assert.equal(result.unbookedNights, null);
  assert.equal(result.coverage.status, 'unknown'); assert.equal(result.coverage.eligibleUnitNights, 0);
  assert.equal(result.platformShare[0].share, 1);
});
test('complete coverage counts local nights over DST and pools unit-night denominators', () => {
  const input = { properties: [property('a', true), property('b', true)], events: [event(), event({ id: 'b-stay', propertyId: 'b', endDate: to })] };
  const result = calculate(input, from, to);
  assert.equal(result.totals.occupiedNights, 6); assert.equal(result.totals.coverage.totalUnitNights, 8);
  assert.equal(result.totals.occupancy, 0.75); assert.equal(result.totals.unbookedNights, 2);
});
test('mixed/overlapping coverage is unioned but never inferred from observed stays', () => {
  const input: OwnerAnalyticsInput = { properties: [property('a', true), { ...property('b'), coverage: [{ from, toExclusive: '2026-03-09' }, { from, toExclusive: '2026-03-08' }] }], events: [] };
  const result = calculate(input, from, to).totals;
  assert.equal(result.coverage.eligibleUnitNights, 6); assert.equal(result.coverage.status, 'partial');
  assert.equal(result.occupancy, null); assert.equal(result.unbookedNights, null);
});
test('deduplicates nights, reservations win over blocks, blocks origin is always unknown', () => {
  const result = run([event(), event(), event({ id: 'block', kind: 'blocked', confirmed: false, endDate: to, origin: 'vrbo' })], true).totals;
  assert.equal(result.bookedNights, 2); assert.equal(result.blockedNights, 2); assert.equal(result.checkIns, 1);
  assert.equal(result.occupiedNights, 4); assert.equal(result.occupancy, 1);
  assert.deepEqual(result.platformShare.map(x => x.nights), [2, 0, 2]);
});
test('ambiguous overlapping booking origins attribute unknown rather than double counting', () => {
  const result = run([event(), event({ id: 'other', origin: 'vrbo' })]).totals;
  assert.equal(result.bookedNights, 2); assert.equal(result.checkIns, 2);
  assert.deepEqual(result.platformShare.map(x => x.nights), [0, 0, 2]);
});
test('unknown, tentative and removed records are neither occupied nor proven free', () => {
  const result = run([event({ kind: 'unknown' }), event({ id: 'tentative', confirmed: false }), event({ id: 'removed', removed: true })]).totals;
  assert.equal(result.occupiedNights, 0); assert.equal(result.checkIns, 0); assert.equal(result.unbookedNights, null);
  assert(result.platformShare.every(x => x.share === null));
});
test('arrival bounds are inclusive start/exclusive end, nights clipped independently', () => {
  const result = run([event({ startDate: '2026-03-06' }), event({ id: 'late', startDate: to, endDate: '2026-03-12' })]).totals;
  assert.equal(result.bookedNights, 2); assert.equal(result.checkIns, 0);
});
test('empty selection and invalid inputs remain explicit, never NaN', () => {
  const empty = calculate({ properties: [], events: [] }, from, to).totals;
  assert.equal(empty.occupancy, null); assert.equal(empty.coverage.totalUnitNights, 0);
  assert.throws(() => calculate({ properties: [], events: [] }, '2026-02-30', to));
  assert.throws(() => calculate({ properties: [property()], events: [event({ propertyId: 'foreign' })] }, from, to));
});

test('same-day timed stay contributes a confirmed arrival and zero occupied nights', () => {
  const result = run([event({ endDate: from })], true).totals;
  assert.equal(result.checkIns, 1); assert.equal(result.bookedNights, 0);
  assert.equal(result.occupiedNights, 0); assert.equal(result.unbookedNights, 4);
  assert.equal(result.occupancy, 0);
  assert.throws(() => run([event({ endDate: '2026-03-06' })]));
});
