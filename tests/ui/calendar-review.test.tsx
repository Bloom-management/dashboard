import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalendarReviewList } from '../../src/components/bloom/calendar-review';
import type { CalendarReviewEntry } from '../../src/contracts';

const entry: CalendarReviewEntry = {id:'fixture-entry',sourceId:'private-source-id',provider:'airbnb',startDate:'2026-09-18',endDate:'2026-09-20',kind:'blocked',status:'active',reviewRequired:true,missingReason:null};

test('flagged calendar entries are read-only and never render injected private source fields', () => {
  const input = {...entry, uid:'private-uid', url:'private-feed-url', guest:'private-guest'};
  const html = renderToStaticMarkup(<CalendarReviewList entries={[input]}/>);
  assert.match(html,/Blocked period/);
  assert.match(html,/Airbnb/);
  assert.match(html,/Needs review/);
  assert.match(html,/End date exclusive/);
  assert.match(html,/does not create a new cleaning job/);
  assert.doesNotMatch(html,/private-source-id|private-uid|private-feed-url|private-guest|<button|<input/);
});

test('missing events explain uncertain export horizon instead of asserting cancellation', () => {
  const html = renderToStaticMarkup(<CalendarReviewList entries={[{...entry,kind:'unknown',status:'removed',missingReason:'horizon_unknown'}]}/>);
  assert.match(html,/Unconfirmed period/);
  assert.match(html,/Removed from source/);
  assert.match(html,/not a confirmed cancellation/);
});

test('empty review state and confirmed reservation labels are explicit', () => {
  assert.match(renderToStaticMarkup(<CalendarReviewList entries={[]}/>),/No flagged calendar entries/);
  const html = renderToStaticMarkup(<CalendarReviewList entries={[{...entry,kind:'reservation',provider:'vrbo',reviewRequired:false}]}/>);
  assert.match(html,/Reservation/);
  assert.match(html,/Vrbo/);
  assert.match(html,/No review flag/);
  assert.doesNotMatch(html,/does not create a new cleaning job/);
});
