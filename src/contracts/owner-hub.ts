import type { MaintenanceReport } from './maintenance';
import type { Instant, LocalDate, OwnerCalendarBlock, Provider, SupplyLevel } from './index';
export type OwnerCoverage = { status: 'unknown' | 'partial' | 'complete'; from: LocalDate; toExclusive: LocalDate; eligibleUnitNights: number; totalUnitNights: number; message: string };
export type OwnerSupply = { supplyId: string; name: string; level: SupplyLevel | null; reportedAt: Instant | null };
export type OwnerSource = { id: string; propertyId: string; provider: Provider; enabled: boolean; lastSuccessAt: Instant | null; lastAttemptAt: Instant | null; message: string | null };
export type OwnerListing = { maintenance?:MaintenanceReport[]; cityId?: string | null; cityName?: string | null; id: string; name: string; timezone: string; active: boolean; setupRequired?: boolean; bedroomCount?: number | null; bathroomCount?: number | null; supplies: OwnerSupply[]; suppliesUnavailable?: boolean; nightlyGuestRateCents: null; hostPayoutCents: null; currency: 'USD'; sources: OwnerSource[] };
/** Internal authorized analytics projection: no raw UID, guest details or cleaner data. */
export type OwnerNightEvent = { id: string; propertyId: string; startDate: LocalDate; endDate: LocalDate; kind: 'reservation' | 'blocked' | 'unknown'; removed: boolean; confirmed: boolean; origin: 'airbnb' | 'vrbo' | 'unknown' };
export type OwnerAnalyticsInput = { properties: { id: string; name: string; timezone: string; coverage: { from: LocalDate; toExclusive: LocalDate }[] }[]; events: OwnerNightEvent[] };
export type OwnerMetricTotals = { bookedNights: number; blockedNights: number; occupiedNights: number; unbookedNights: number | null; checkIns: number; occupancy: number | null; coverage: OwnerCoverage; platformShare: { platform: 'airbnb' | 'vrbo' | 'unknown'; nights: number; share: number | null }[] };
export type OwnerPerformance = { from: LocalDate; toExclusive: LocalDate; totals: OwnerMetricTotals; properties: ({ propertyId: string; propertyName: string } & OwnerMetricTotals)[]; assumption: string };
export type OwnerListingsPage = { items: OwnerListing[]; nextCursor: string | null };
export type OwnerTimeline = { properties: { id: string; name: string; timezone: string }[]; blocks: OwnerCalendarBlock[] };

/** Owner identity is derived exclusively from the verified server session. */
export type OwnerListingCreateInput = { name: string; address: string; cityId: string; timezone: string; bedroomCount: number; bathroomCount: number };
export type OwnerListingCreateResult = { listing: OwnerListing };
