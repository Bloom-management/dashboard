import type { OwnerAnalyticsInput, OwnerMetricTotals, OwnerPerformance } from '../../contracts/owner-hub';
import { CalendarError } from './errors';

const DAY = 86_400_000;
function day(value: string): number {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) throw new CalendarError('VALIDATION_ERROR', 400);
  return parsed / DAY;
}
/** Pure calculation over an already-authorized projection. Ratios are fractions (0–1).
 * Date labels represent property-local nights, so DST never changes the night count. */
export function calculateOwnerPerformance(input: OwnerAnalyticsInput, from: string, toExclusive: string): OwnerPerformance {
  const start = day(from), end = day(toExclusive), count = end - start;
  if (count < 1 || count > 1830 || input.properties.length > 100) throw new CalendarError('VALIDATION_ERROR', 400);
  const ids = new Set(input.properties.map(p => p.id));
  if (ids.size !== input.properties.length || input.events.some(e => !ids.has(e.propertyId))) throw new CalendarError('CONFIGURATION_ERROR', 503);
  const summarize = (bookedNights: number, blockedNights: number, checkIns: number, eligibleUnitNights: number, totalUnitNights: number, origins: Record<'airbnb' | 'vrbo' | 'unknown', number>): OwnerMetricTotals => {
    const occupiedNights = bookedNights + blockedNights;
    const status = totalUnitNights > 0 && eligibleUnitNights === totalUnitNights ? 'complete' : eligibleUnitNights > 0 ? 'partial' : 'unknown';
    return { bookedNights, blockedNights, occupiedNights, checkIns,
      unbookedNights: status === 'complete' ? totalUnitNights - occupiedNights : null,
      occupancy: status === 'complete' ? occupiedNights / totalUnitNights : null,
      coverage: { status, from, toExclusive, eligibleUnitNights, totalUnitNights,
        message: status === 'complete' ? 'Authoritative coverage is complete for this range.' : 'Known stays and blocks only. Calendar exports do not prove that other nights are available.' },
      platformShare: (['airbnb', 'vrbo', 'unknown'] as const).map(platform => ({ platform, nights: origins[platform], share: occupiedNights ? origins[platform] / occupiedNights : null })),
    };
  };
  const properties = input.properties.map(property => {
    const covered = new Set<number>();
    for (const interval of property.coverage) {
      const lo = day(interval.from), hi = day(interval.toExclusive);
      if (hi <= lo) throw new CalendarError('CONFIGURATION_ERROR', 503);
      for (let n = Math.max(start, lo); n < Math.min(end, hi); n++) covered.add(n);
    }
    const nights = new Map<number, { reservations: Set<'airbnb' | 'vrbo' | 'unknown'>; blocked: boolean }>();
    const arrivals = new Set<string>();
    const ambiguous = new Set<number>();
    for (const event of input.events.filter(e => e.propertyId === property.id && !e.removed)) {
      const lo = day(event.startDate), hi = day(event.endDate);
      // Timed same-day stays have a valid arrival but occupy zero overnight dates.
      if (hi < lo) throw new CalendarError('CONFIGURATION_ERROR', 503);
      const reserved = event.kind === 'reservation' && event.confirmed;
      const blocked = event.kind === 'blocked';
      if (!reserved && !blocked) {
        for (let n = Math.max(start, lo); n < Math.min(end, hi); n++) ambiguous.add(n);
        continue;
      }
      if (reserved && lo >= start && lo < end) arrivals.add(event.id);
      for (let n = Math.max(start, lo); n < Math.min(end, hi); n++) {
        const value = nights.get(n) ?? { reservations: new Set<'airbnb' | 'vrbo' | 'unknown'>(), blocked: false };
        if (reserved) value.reservations.add(event.origin);
        else value.blocked = true;
        nights.set(n, value);
      }
    }
    // Unknown-only observations cannot become free nights, even in a coverage fixture.
    // A positive reservation/block at the same night still establishes occupied use.
    for (const n of ambiguous) if (!nights.has(n)) covered.delete(n);
    let booked = 0, blocked = 0;
    const origins = { airbnb: 0, vrbo: 0, unknown: 0 };
    for (const value of nights.values()) {
      if (value.reservations.size) {
        booked++;
        const origin = value.reservations.size === 1 ? [...value.reservations][0] : 'unknown';
        origins[origin]++;
      } else if (value.blocked) { blocked++; origins.unknown++; }
    }
    return { propertyId: property.id, propertyName: property.name, ...summarize(booked, blocked, arrivals.size, covered.size, count, origins) };
  });
  const sum = (key: 'bookedNights' | 'blockedNights' | 'checkIns') => properties.reduce((n, p) => n + p[key], 0);
  const origins = { airbnb: 0, vrbo: 0, unknown: 0 };
  for (const property of properties) for (const share of property.platformShare) origins[share.platform] += share.nights;
  const totals = summarize(sum('bookedNights'), sum('blockedNights'), sum('checkIns'), properties.reduce((n, p) => n + p.coverage.eligibleUnitNights, 0), count * properties.length, origins);
  return { from, toExclusive, totals, properties,
    assumption: 'Known blocks count as occupied for analytics, not as cleaning jobs. Reservations take precedence over blocks. Platform shares use unique known occupied nights; uncertain origins are Off-platform / unknown. Check-ins count distinct confirmed booking identities; cross-feed duplicates cannot be proven from dates alone. Price updates coming soon.' };
}
