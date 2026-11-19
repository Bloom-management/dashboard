import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { JobStaffing } from '../../src/components/bloom/job-staffing';
import type { CleanerJob } from '../../src/contracts';

const job = { id: 'j', propertyId: 'p', propertyName: '3628 Trumbull', cityId: 'c', checkoutDate: '2026-11-20', startAt: '2026-11-20T16:00:00Z', endAt: '2026-11-20T20:00:00Z', timezone: 'America/Detroit', status: 'open', reviewRequired: false, version: 3, soloRateCents: 7500, sharedRateCents: 3750, activeCleanerCount: 1, myAssignmentId: null, myCompletedPayCents: null, capacity: 2, changes: [] } as unknown as CleanerJob;
const resource = (data: { id: string; cleanerId?: string; cleanerName: string; avatarUrl?: string | null }[]) => ({ data, loading: false, error: undefined, reload: () => {} }) as never;
const render = (data: Parameters<typeof resource>[0]) => renderToStaticMarkup(<JobStaffing job={job} integration={{}} assignments={resource(data)} onChanged={() => {}} />);
const count = (html: string, text: string) => html.split(text).length - 1;

test('no cleaners: two open placeholders', () => {
  const html = render([]);
  assert.match(html, /Who&#x27;s working/);
  assert.equal(count(html, '>Open slot<'), 2);
  assert.match(html, /0 of 2/);
});

test('solo: the assigned cleaner plus one open placeholder', () => {
  const html = render([{ id: 'a1', cleanerId: 'u1', cleanerName: 'Alexis Thomas', avatarUrl: null }]);
  assert.match(html, /Alexis Thomas/);
  assert.equal(count(html, '>Open slot<'), 1);
  assert.match(html, /1 of 2/);
  assert.match(html, /aria-label="Alexis Thomas: reassign or remove"/);
  assert.match(html, /aria-label="Open slot: assign a cleaner"/);
});

test('team: both cleaners, no placeholder', () => {
  const html = render([{ id: 'a1', cleanerName: 'Alexis Thomas' }, { id: 'a2', cleanerName: 'Moon Guy' }]);
  assert.equal(count(html, '>Open slot<'), 0);
  assert.match(html, /2 of 2/);
});
