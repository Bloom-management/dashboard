import ICAL from 'ical.js';
import { DateTime, IANAZone } from 'luxon';
import { createHash } from 'node:crypto';
import { CalendarError } from './errors';
import type { Event, Provider, Snapshot } from './types';
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const eventKey = (e: Pick<Event, 'uid' | 'recurrenceKey'>) => JSON.stringify([e.uid, e.recurrenceKey]);
function zoned(time: ICAL.Time, tzid: string | undefined, propertyZone: string) {
  const zone = time.zone.tzid === 'UTC' ? 'UTC' : tzid || propertyZone;
  if (zone !== 'UTC' && !IANAZone.isValidZone(zone)) throw new Error('timezone');
  const parts = { year: time.year, month: time.month, day: time.day, hour: time.hour, minute: time.minute, second: time.second };
  const result = DateTime.fromObject(parts, { zone });
  // Luxon normalizes nonexistent local times; refuse that ambiguity and DST folds.
  if (!result.isValid || Object.entries(parts).some(([k,v]) => result.get(k as keyof typeof parts) !== v) || result.getPossibleOffsets().length !== 1) throw new Error('time');
  return result;
}
function dateValue(component: ICAL.Component, name: string, propertyZone: string) {
  const properties = component.getAllProperties(name);
  if (properties.length !== 1) throw new Error('missing or duplicate date');
  const property = properties[0];
  const rawValue = property.toJSON()[3];
  const time = property.getFirstValue() as ICAL.Time;
  if (typeof rawValue !== 'string' || time.toString() !== rawValue) throw new Error('normalized invalid date');
  if (!time || typeof time.isDate !== 'boolean') throw new Error('date');
  if (time.isDate) {
    const value = time.toString();
    const parsed = DateTime.fromISO(value, { zone: 'UTC' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !parsed.isValid || parsed.toISODate() !== value) throw new Error('date');
    return { date: value, instant: parsed.toMillis(), allDay: true, identity: value };
  }
  const tzid = property.getParameter('tzid') as string | undefined;
  const parsed = zoned(time, tzid, propertyZone);
  return { date: parsed.setZone(propertyZone).toISODate()!, instant: parsed.toMillis(), allDay: false, identity: parsed.toUTC().toISO()! };
}
export function cleaningWindow(date: string, zone: string) {
  if (!IANAZone.isValidZone(zone) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new CalendarError('INVALID_CALENDAR');
  const local = (hour: number) => {
    const value = DateTime.fromISO(`${date}T${hour}:00:00`, { zone });
    if (!value.isValid || value.toISODate() !== date || value.hour !== hour || value.getPossibleOffsets().length !== 1) throw new CalendarError('INVALID_CALENDAR');
    return value.toUTC().toISO()!;
  };
  return { startAt: local(11), endAt: local(15) };
}
/** No destructive coverage inferred from a subscription: its export horizon is undocumented. */
export function normalize(ics: string, provider: Provider, propertyZone: string): Snapshot {
  if (!IANAZone.isValidZone(propertyZone) || Buffer.byteLength(ics) > 1_048_576) throw new CalendarError('INVALID_CALENDAR');
  // Strict envelope complements the maintained parser's permissive handling of truncated input.
  const lines = ics.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines[0] !== 'BEGIN:VCALENDAR' || lines.at(-1) !== 'END:VCALENDAR') throw new CalendarError('INVALID_CALENDAR');
  const stack: string[] = [];
  for (const line of lines) {
    if (line.startsWith('BEGIN:')) stack.push(line.slice(6));
    else if (line.startsWith('END:') && stack.pop() !== line.slice(4)) throw new CalendarError('INVALID_CALENDAR');
  }
  if (stack.length || lines.filter(l => l === 'BEGIN:VCALENDAR').length !== 1) throw new CalendarError('INVALID_CALENDAR');
  let calendar: ICAL.Component;
  try { calendar = new ICAL.Component(ICAL.parse(ics)); } catch { throw new CalendarError('INVALID_CALENDAR'); }
  if (calendar.getFirstPropertyValue('version') !== '2.0' || calendar.getAllProperties('version').length !== 1) throw new CalendarError('INVALID_CALENDAR');
  const method = calendar.getFirstPropertyValue('method');
  if ((method && method !== 'PUBLISH') || calendar.getAllSubcomponents().some(c => c.name !== 'vevent')) {
    return { events: [], issues: [{ code: 'UNSUPPORTED_CALENDAR' }], complete: false, coverage: null };
  }
  const result: Snapshot = { events: [], issues: [], complete: true, coverage: null };
  const components = calendar.getAllSubcomponents('vevent');
  if (components.length > 5000) throw new CalendarError('INVALID_CALENDAR');
  const events = new Map<string, Event>();
  const conflicts = new Set<string>();
  for (const component of components) {
    let key: string | undefined;
    try {
      const uid = component.getFirstPropertyValue('uid') as string;
      if (typeof uid !== 'string' || !uid.trim() || uid.length > 1024 || component.getAllProperties('uid').length !== 1) throw new Error('uid');
      const recurrenceKey = component.hasProperty('recurrence-id') ? dateValue(component, 'recurrence-id', propertyZone).identity : '';
      key = eventKey({ uid, recurrenceKey });
      // Recurring exports were absent in supplied feeds. Reject entire recurring series safely.
      if (['rrule', 'rdate', 'exrule', 'exdate'].some(p => component.hasProperty(p))) throw new Error('recurrence');
      const start = dateValue(component, 'dtstart', propertyZone);
      const end = dateValue(component, 'dtend', propertyZone);
      if (component.hasProperty('duration') || start.allDay !== end.allDay || end.instant <= start.instant || end.date < start.date) throw new Error('range');
      if (['summary', 'description', 'status', 'recurrence-id'].some(p => component.getAllProperties(p).length > 1)) throw new Error('duplicate singleton');
      const summary = component.getFirstPropertyValue('summary');
      const description = String(component.getFirstPropertyValue('description') || '');
      const status = String(component.getFirstPropertyValue('status') || '').toUpperCase();
      if (!['', 'CONFIRMED', 'TENTATIVE', 'CANCELLED'].includes(status)) throw new Error('status');
      // Evidence from the supplied Airbnb export. No dependence on names, phone numbers or price.
      const reservation = provider === 'airbnb' && summary === 'Reserved' && uid.endsWith('@airbnb.com') && /(?:^|\s)https:\/\/www\.airbnb\.com\/hosting\/reservations\/details\/[A-Za-z0-9]+(?:\s|$)/.test(description);
      const blocked = provider === 'vrbo' && summary === 'Blocked';
      const kind = reservation && status !== 'TENTATIVE' ? 'reservation' : blocked ? 'blocked' : 'unknown';
      const data = { uid, recurrenceKey, startDate: start.date, endDate: end.date, kind,
        status: status === 'CANCELLED' ? 'cancelled' : 'active',
        evidence: reservation ? 'airbnb-reservation-link' : blocked ? 'observed-block' : 'unverified',
        reviewRequired: kind !== 'reservation' } as const;
      const event: Event = { ...data, contentHash: hash(data) };
      if (events.has(key) && events.get(key)!.contentHash !== event.contentHash) { conflicts.add(key); throw new Error('duplicate'); }
      events.set(key, event);
    } catch {
      result.complete = false;
      result.issues.push({ code: 'EVENT_REVIEW_REQUIRED', ...(key ? { eventKey: hash(key) } : {}) });
      if (key) conflicts.add(key);
    }
  }
  result.events = [...events.entries()].filter(([key]) => !conflicts.has(key)).map(([,e]) => e);
  return result;
}
