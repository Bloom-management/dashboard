import type { Provider, NormalizedCalendarEvent, SyncResult } from '../../contracts/index';
export type { Provider, SyncResult };
export type SyncOutcome = SyncResult & { status: 'success' | 'partial' | 'not_modified' };
export type Issue = { code: string; eventKey?: string };
export type Event = NormalizedCalendarEvent & {
  status: 'active' | 'cancelled'; evidence: 'airbnb-reservation-link' | 'observed-block' | 'unverified';
  reviewRequired: boolean;
};
export type Snapshot = { events: Event[]; issues: Issue[]; complete: boolean; coverage: null };
export type Source = {
  id: string; propertyId: string; provider: Provider; encryptedUrl: string; timezone: string;
  enabled: boolean; syncVersion: number; etag?: string; lastModified?: string;
};
export type SourceHealth = { id: string; propertyId: string; provider: Provider; enabled: boolean;
  lastSuccessAt: string | null; lastAttemptAt: string | null; errorCode: string | null; action: string | null };
export type Lease = { runId: string; version: number; source: Source };
/** All mutations below MUST be implemented as transactional, authorization-checking RPCs.
 * No read/modify/write REST implementation is safe. See HANDOFF.md. */
export interface CalendarStore {
  addSource(input: { propertyId: string; provider: Provider; encryptedUrl: string; fingerprint: string; urlDigest: string }, key: string): Promise<SourceHealth>;
  listSources(cursor?: string): Promise<{ items: SourceHealth[]; nextCursor: string | null }>;
  beginSync(sourceId: string, key: string): Promise<Lease | { result: SyncOutcome }>;
  finishSync(lease: Lease, snapshot: Snapshot | null, validators: { etag?: string; lastModified?: string }): Promise<SyncOutcome>;
  failSync(lease: Lease, code: string): Promise<void>;
  enabledSourceIds(cursor?: string): Promise<{ ids: string[]; nextCursor: string | null }>;
}
