import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, monthCells, monthRange, shiftMonth, todayIn, money } from '../../src/components/bloom/dates.ts';
import { mayClaim, mayWithdraw } from '../../src/components/bloom/job-policy.ts';

test('calendar labels survive leap years and month/year boundaries', () => {
  assert.deepEqual(monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  assert.equal(monthCells('2028-02').filter(Boolean).length, 29);
  assert.equal(monthCells('2026-08').length % 7, 0);
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});
test('property time zones, including DST, determine the displayed date and window', () => {
  assert.equal(todayIn('America/Detroit', new Date('2026-06-01T02:00:00Z')), '2026-05-31');
  assert.equal(formatTime('2026-03-07T16:00:00Z', 'America/Detroit'), '11:00 AM');
  assert.equal(formatTime('2026-03-08T15:00:00Z', 'America/Detroit'), '11:00 AM');
  assert.equal(formatTime('2026-11-01T16:00:00Z', 'America/Detroit'), '11:00 AM');
  assert.equal(money(3750), '$37.50');
});
test('self-withdrawal hint includes the exact six-hour boundary', () => {
  const job = { startAt: '2026-06-01T15:00:00Z' };
  const boundary = Date.parse('2026-06-01T09:00:00Z');
  assert.equal(mayWithdraw(job, boundary), true);
  assert.equal(mayWithdraw(job, boundary + 1), false);
});
test('claim hints never close the second slot and have no daily job limit', () => {
  const job = { status: 'open', reviewRequired: false, activeCleanerCount: 1, myAssignmentId: null, endAt: '2026-06-01T19:00:00Z' };
  const now = Date.parse('2026-06-01T16:00:00Z');
  assert.equal(mayClaim(job, now), true);
  assert.equal(mayClaim({ ...job, activeCleanerCount: 2 }, now), false);
  assert.equal(mayClaim({ ...job, myAssignmentId: 'synthetic-assignment' }, now), false);
  assert.equal(mayClaim({ ...job, reviewRequired: true }, now), false);
  assert.equal(mayClaim(job, Date.parse(job.endAt)), false);
});

test('explicit server practice exception lifts only the withdrawal deadline',()=>{assert.equal(mayWithdraw({startAt:'2026-09-19T15:00:00Z',withdrawalDeadlineExempt:true},Date.parse('2026-09-19T18:00:00Z')),true);assert.equal(mayWithdraw({startAt:'2026-09-19T15:00:00Z'},Date.parse('2026-09-19T18:00:00Z')),false);});
