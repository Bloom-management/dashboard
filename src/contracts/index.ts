import type { MaintenanceAnswer, MaintenanceReport } from './maintenance';
/** Contract v1. Main/integration owns changes; no database row types in UI. */
export type Role = 'admin' | 'owner' | 'cleaner';
export type PhotoCategory = 'bedrooms' | 'bathrooms' | 'kitchen' | 'living_room';
export type Provider = 'airbnb' | 'vrbo';
export type LocalDate = string; // YYYY-MM-DD; validate at runtime
export type Instant = string; // ISO8601 UTC; validate at runtime
export type SessionUser = { id: string; role: Role; displayName: string; approvedCityId: string | null };
export type InlineChange = { id: string; type: 'changed' | 'removed' | 'conflict'; message: string; acknowledged: boolean };
export type CleanerJob = {
  id: string; propertyId: string; propertyName: string; cityId: string;
  checkoutDate: LocalDate; startAt: Instant; endAt: Instant; timezone: string;
  status: 'open' | 'completed' | 'cancelled'; reviewRequired: boolean; version: number;
  soloRateCents: number; sharedRateCents: number; activeCleanerCount: number;
  myAssignmentId: string | null; myCompletedPayCents: number | null;
  withdrawalDeadlineExempt?: boolean;
  changes: InlineChange[];
};
/** Deliberately excludes cleaner, assignment, pay, photo and feed-secret fields. */
export type OwnerCalendarBlock = {
  id: string; propertyId: string; propertyName: string; timezone: string;
  startDate: LocalDate; endDate: LocalDate; providers: Provider[];
  kind: 'reservation' | 'blocked' | 'unknown'; removed: boolean; changes: InlineChange[];
};
export type JobPhoto = { roomId?: string | null; uploaderName?: string; id: string; jobId: string; uploaderId: string; category: PhotoCategory; createdAt: Instant; state: 'pending' | 'ready' };
export type NormalizedCalendarEvent = {
  uid: string; recurrenceKey: string; startDate: LocalDate; endDate: LocalDate;
  kind: 'reservation' | 'blocked' | 'unknown'; contentHash: string;
};
export type SyncResult = { runId: string; created: number; updated: number; removed: number; unchanged: number; conflicts: number };
export type ErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'CITY_MISMATCH' | 'JOB_FULL' | 'ALREADY_ASSIGNED' | 'WITHDRAWAL_DEADLINE' | 'INVALID_STATE' | 'REVIEW_REQUIRED' | 'PHOTO_COVERAGE_REQUIRED' | 'CONFLICT' | 'SOURCE_UNAVAILABLE' | 'CONFIGURATION_ERROR';
export type ApiResult<T> = { data: T } | { error: { code: ErrorCode; message: string; requestId: string } };

/** Admin-only occupancy review; never includes feed URLs, guest details or raw event identities. */
export type CalendarReviewEntry = {
  id: string; sourceId: string; provider: Provider; startDate: LocalDate; endDate: LocalDate;
  kind: 'reservation' | 'blocked' | 'unknown'; status: 'active' | 'removed';
  reviewRequired: boolean; missingReason: 'horizon_unknown' | null;
};
export type CalendarReviewPage = { items: CalendarReviewEntry[]; nextCursor: string | null };

export type SupplyLevel = 'full' | 'moderate' | 'low' | 'empty' | 'not_found';
export type CleaningRoom = { id: string; type: PhotoCategory; label: string; requiredPhoto: true };
export type CleaningSupply = { id: string; name: string };
export type CleaningConfig = { version: number; rooms: CleaningRoom[]; supplies: CleaningSupply[] };
export type CompletionInput = { configVersion: number; answers: { supplyId: string; level: SupplyLevel }[]; notes: string; maintenance?:MaintenanceAnswer[] };
export type CompletionReceipt = { maintenance?:MaintenanceAnswer[]; jobId: string; eventId: string; completedAt: string; completedBy: string; notes: string; reports: { supplyId: string; name: string; level: SupplyLevel }[] };
export type CompletionResult = { job: CleanerJob; receipt: CompletionReceipt };
export type JobJourney = { previousMaintenance?:MaintenanceReport[]; job: CleanerJob; config: CleaningConfig | null; startedAt: string | null; startedBy: string | null; previousReports: { supplyId: string; level: SupplyLevel; reportedAt: string }[]; receipt: CompletionReceipt | null };
