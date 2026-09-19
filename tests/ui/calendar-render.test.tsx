import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { BookingCalendar, Calendar, calendarDate, calendarValue } from '../../src/components/ui/calendar';

test('shared booking calendar renders six complete weeks and only requests current-month data', () => {
  const dates: string[] = [];
  const markup = renderToStaticMarkup(<BookingCalendar month="2028-02" today="2028-02-29">{date => { dates.push(date); return <button>{date}</button>; }}</BookingCalendar>);
  assert.equal((markup.match(/<td\b/g) ?? []).length, 42);
  assert.equal(dates.length, 29);
  assert.equal(new Set(dates).size, 29);
  assert.ok(dates.every(date => date.startsWith('2028-02-')));
  assert.match(markup, /aria-current="date"/);
  assert.doesNotMatch(markup, /<button[^>]*>[^<]*<button/);
});

test('date picker uses date-only UTC values and exposes month navigation', () => {
  assert.equal(calendarValue(calendarDate('2026-03-08')), '2026-03-08');
  const markup = renderToStaticMarkup(<Calendar mode="single" month={calendarDate('2026-12')} />);
  assert.match(markup, /Go to the Previous Month/i);
  assert.match(markup, /Go to the Next Month/i);
});
