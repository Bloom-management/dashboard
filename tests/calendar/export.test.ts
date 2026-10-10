import { test } from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import { serializeBloomCalendar, createCalendarExportToken, hashCalendarExportToken, type BloomExportEvent } from '../../src/server/calendar/export';
const booking: BloomExportEvent = { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', checkIn: '2026-03-07', checkout: '2026-03-09', updatedAt: '2026-03-01T12:30:00-05:00', sequence: 0 };
const parse = (value: string) => new ICAL.Component(ICAL.parse(value)).getAllSubcomponents('vevent');

test('exports property-local all-day nights across DST with exclusive checkout and CRLF', () => {
  const feed = serializeBloomCalendar([booking]);
  assert.equal(feed.replaceAll('\r\n', '').includes('\n'), false);
  assert.ok(feed.endsWith('\r\n'));
  for (const line of feed.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  const [event] = parse(feed);
  const start = event.getFirstPropertyValue('dtstart') as ICAL.Time;
  const end = event.getFirstPropertyValue('dtend') as ICAL.Time;
  assert.equal(start.isDate, true); assert.equal(end.isDate, true);
  assert.equal(start.toString(), '2026-03-07'); assert.equal(end.toString(), '2026-03-09');
  assert.equal(event.getFirstPropertyValue('dtstamp')?.toString(), '2026-03-01T17:30:00Z');
});
test('edits preserve event identity; canceled records omitted from full snapshot', () => {
  const original = parse(serializeBloomCalendar([booking]))[0];
  const edited = parse(serializeBloomCalendar([{ ...booking, checkout: '2026-03-10', sequence: 1 }]))[0];
  assert.equal(original.getFirstPropertyValue('uid'), edited.getFirstPropertyValue('uid'));
  assert.equal(edited.getFirstPropertyValue('sequence'), 1);
  assert.equal(parse(serializeBloomCalendar([])).length, 0);
});
test('exports only generic availability regardless of surplus private fields', () => {
  const input = { ...booking, guest: 'Private Guest', comments: 'Private instructions', compensation: 9000, cleaner: 'Private Cleaner' };
  const feed = serializeBloomCalendar([input]);
  assert.equal(feed.includes('Private'), false); assert.equal(feed.includes('9000'), false);
  const [event] = parse(feed);
  assert.equal(event.getFirstPropertyValue('summary'), 'Reserved');
  assert.equal(event.getFirstProperty('description'), null);
});
test('adjacent and cross-month bookings retain exact date boundaries', () => {
  const events = parse(serializeBloomCalendar([{ ...booking, checkIn: '2026-10-31', checkout: '2026-11-02' }, { ...booking, id: 'bbbbbbbb-1111-4111-8111-aaaaaaaaaaaa', checkIn: '2026-11-02', checkout: '2026-11-04' }]));
  assert.equal(events[0].getFirstPropertyValue('dtend')?.toString(), events[1].getFirstPropertyValue('dtstart')?.toString());
});
test('rejects malformed dates, ranges, identifiers, timestamps, sequences and duplicate identities', () => {
  for (const patch of [{ checkIn: '2026-02-30' }, { checkout: booking.checkIn }, { id: 'bad\r\nSUMMARY:injected' }, { updatedAt: '2026-03-01' }, { sequence: -1 }, { sequence: 0.5 }]) {
    assert.throws(() => serializeBloomCalendar([{ ...booking, ...patch }]));
  }
  assert.throws(() => serializeBloomCalendar([booking, booking]));
});
test('export capabilities are random 256-bit tokens with stable opaque digests', () => {
  const a = createCalendarExportToken(), b = createCalendarExportToken();
  assert.match(a, /^[a-f0-9]{64}$/); assert.notEqual(a, b);
  assert.equal(hashCalendarExportToken(a), hashCalendarExportToken(a));
  assert.notEqual(hashCalendarExportToken(a), hashCalendarExportToken(b));
  assert.match(hashCalendarExportToken(a), /^[a-f0-9]{64}$/);
  assert.throws(() => hashCalendarExportToken('guess'));
});
