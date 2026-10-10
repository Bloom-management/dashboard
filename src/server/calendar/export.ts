import { createHash, randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';

/** The caller must select only active, manually created bookings for one property.
 * Never pass imported events or private booking details into the subscription feed. */
export type BloomExportEvent = {
  id: string;
  checkIn: string;
  checkout: string;
  updatedAt: string;
  sequence: number;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function localDate(value: string): string {
  const date = DateTime.fromISO(value, { zone: 'UTC' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !date.isValid || date.toISODate() !== value) {
    throw new Error('Invalid calendar export date');
  }
  return value.replaceAll('-', '');
}
const text = (value: string) => value.replaceAll('\\', '\\\\').replace(/\r\n|\r|\n/g, '\\n').replaceAll(';', '\\;').replaceAll(',', '\\,');
/** RFC 5545 limits physical content lines to 75 octets, including continuation spaces. */
function fold(line: string): string {
  let result = '', width = 0;
  for (const character of line) {
    const bytes = Buffer.byteLength(character, 'utf8');
    if (width + bytes > 75) { result += '\r\n '; width = 1; }
    result += character;
    width += bytes;
  }
  return result;
}

/** All-day dates intentionally have no timezone conversion: checkout is exclusive.
 * Full subscription snapshots omit canceled bookings. Consumers control refresh timing. */
export function serializeBloomCalendar(events: readonly BloomExportEvent[]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bloom Cleaning//Availability//EN', 'CALSCALE:GREGORIAN'];
  const ids = new Set<string>();
  for (const event of [...events].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!uuid.test(event.id) || ids.has(event.id.toLowerCase())) throw new Error('Invalid or duplicate calendar export ID');
    ids.add(event.id.toLowerCase());
    const start = localDate(event.checkIn), end = localDate(event.checkout);
    if (event.checkout <= event.checkIn) throw new Error('Checkout must follow check-in');
    const updated = DateTime.fromISO(event.updatedAt, { setZone: true });
    if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(event.updatedAt) || !updated.isValid) throw new Error('Invalid calendar export timestamp');
    if (!Number.isSafeInteger(event.sequence) || event.sequence < 0 || event.sequence > 2147483647) throw new Error('Invalid calendar export sequence');
    const stamp = updated.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
    lines.push('BEGIN:VEVENT', `UID:${text(`bloom-booking-${event.id.toLowerCase()}@bloomcleaning.org`)}`,
      `DTSTAMP:${stamp}`, `LAST-MODIFIED:${stamp}`, `SEQUENCE:${event.sequence}`,
      `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`, 'SUMMARY:Reserved',
      'STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** 256-bit bearer capability. Store its digest for lookup and encrypt any recoverable copy. */
export const createCalendarExportToken = (): string => randomBytes(32).toString('hex');
export function hashCalendarExportToken(token: string): string {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid calendar export token');
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
