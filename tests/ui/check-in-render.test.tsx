import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CheckInTile, CheckInNote, CleaningWindow, checkInLabel } from '../../src/components/bloom/check-in';
import type { CleanerJob } from '../../src/contracts';

const job = (checkInAt: string | null): CleanerJob => ({
  id: 'j', propertyId: 'p', propertyName: '3628 Trumbull', cityId: 'c', checkoutDate: '2026-11-18',
  startAt: '2026-11-18T16:00:00Z', endAt: '2026-11-18T20:00:00Z', timezone: 'America/Detroit', checkInAt,
  status: 'open', reviewRequired: false, version: 1, soloRateCents: 7500, sharedRateCents: 3750, activeCleanerCount: 1,
  myAssignmentId: null, myCompletedPayCents: null, changes: [],
} as unknown as CleanerJob);
const noon40 = Date.parse('2026-11-18T17:40:00Z');

test('check-in label is property-local and relative to today', () => {
  assert.deepEqual(checkInLabel(job('2026-11-18T21:00:00Z'), noon40), { time: '4:00', meridiem: 'PM', day: 'today' });
  assert.equal(checkInLabel(job('2026-11-19T21:00:00Z'), noon40)?.day, 'tomorrow');
  assert.equal(checkInLabel(job('2026-11-18T21:00:00Z'), Date.parse('2026-11-10T12:00:00Z'))?.day, 'same day');
  assert.equal(checkInLabel(job('2026-11-25T21:00:00Z'), noon40)?.day, 'Nov 25');
  assert.equal(checkInLabel(job(null), noon40), null);
});

test('claim card tile and info note show check-in or none booked', () => {
  assert.match(renderToStaticMarkup(<CheckInTile job={job(null)} />), /None booked/);
  assert.match(renderToStaticMarkup(<CheckInNote job={job('2026-11-18T21:00:00Z')} now={noon40} />), /Guest check-in.*4:00 PM/);
});

test('cleaning window shows the check-in flag whenever a stay follows', () => {
  const html = renderToStaticMarkup(<CleaningWindow job={job('2026-11-18T21:00:00Z')} />);
  assert.match(html, /Check-in (<!-- -->)?4:00 PM/);
  assert.match(html, /11:00 AM.*3:00 PM/);
  assert.doesNotMatch(renderToStaticMarkup(<CleaningWindow job={job(null)} />), /Check-in/);
  assert.match(renderToStaticMarkup(<CleaningWindow job={job("2026-11-18T20:00:00Z")} />), /Check-in (<!-- -->)?3:00 PM/);
});
