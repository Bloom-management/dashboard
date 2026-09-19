import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize } from '../../src/server/calendar/normalize';

const reservation = readFileSync('tests/calendar/fixtures/airbnb.ics', 'utf8');
const event = reservation.slice(reservation.indexOf('BEGIN:VEVENT'), reservation.indexOf('END:VEVENT') + 'END:VEVENT'.length);
const unavailable = `BEGIN:VEVENT
UID:synthetic-unavailable@airbnb.com
DTSTART;VALUE=DATE:20261201
DTEND;VALUE=DATE:20261204
SUMMARY:Airbnb (Not available)
END:VEVENT`;
const mixed = reservation.replace('END:VCALENDAR', `${unavailable}\nEND:VCALENDAR`);
const parse = (text: string) => normalize(text, 'airbnb', 'America/Detroit');

test('mixed Airbnb export preserves occupancy separately from confirmed reservation evidence', () => {
  const result = parse(mixed);
  assert.equal(result.complete, true);
  assert.equal(result.coverage, null);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.events.map(({ kind, reviewRequired, evidence }) => ({ kind, reviewRequired, evidence })), [
    { kind: 'reservation', reviewRequired: false, evidence: 'airbnb-reservation-link' },
    { kind: 'unknown', reviewRequired: true, evidence: 'unverified' },
  ]);
  assert.deepEqual(parse(mixed), result);
  // No raw descriptions/reservation links survive normalization.
  for (const value of result.events) assert.deepEqual(Object.keys(value).sort(), ['contentHash', 'endDate', 'evidence', 'kind', 'recurrenceKey', 'reviewRequired', 'startDate', 'status', 'uid'].sort());
});

test('labels alone, forged provider hosts and tentative records do not establish a stay', () => {
  const texts = [
    reservation.replace('DESCRIPTION:Reservation URL:', 'DESCRIPTION:Unverified URL:').replace('https://www.airbnb.com/', 'https://www.airbnb.com.evil.test/'),
    reservation.replace('synthetic-reservation@airbnb.com', 'synthetic-reservation@other.test'),
    reservation.replace('SUMMARY:Reserved', 'SUMMARY:Reserved\nSTATUS:TENTATIVE'),
    reservation.replace(/DESCRIPTION:[\s\S]*?(?=END:VEVENT)/, ''),
  ];
  for (const text of texts) {
    const result = parse(text);
    assert.equal(result.complete, true);
    assert.equal(result.events[0].kind, 'unknown');
    assert.equal(result.events[0].reviewRequired, true);
  }
});

test('an invalid additional stay makes the snapshot partial; it is not silently dropped from an authoritative snapshot', () => {
  const invalid = event.replace('synthetic-reservation@', 'synthetic-invalid@').replace('20261101', '20260230');
  const result = parse(mixed.replace('END:VCALENDAR', `${invalid}\nEND:VCALENDAR`));
  assert.equal(result.complete, false);
  assert.equal(result.events.length, 2);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, 'EVENT_REVIEW_REQUIRED');
  assert.match(result.issues[0].eventKey!, /^[a-f0-9]{64}$/);
});

test('changes in guest-only description and export stamps do not change booking identity or content hash', () => {
  const changed = mixed.replace('20260912T000000Z', '20260918T000000Z').replace('DESCRIPTION:Reservation URL:', 'DESCRIPTION:PRIVATE SYNTHETIC GUEST\\nReservation URL:');
  assert.deepEqual(parse(changed), parse(mixed));
});
