import { fetchCalendar, type FetchResult } from './fetch';
import { normalize } from './normalize';
import { revealUrl, protectUrl } from './secrets';
import { CalendarError, safeCode } from './errors';
import type { CalendarStore, Provider } from './types';
export class CalendarService {
  constructor(private store: CalendarStore, private fetcher: typeof fetchCalendar = fetchCalendar) {}
  async addSource(propertyId: string, provider: Provider, url: string, key: string) {
    return this.store.addSource({ propertyId, provider, ...protectUrl(url, provider, propertyId) }, key);
  }
  listSources(cursor?: string) { return this.store.listSources(cursor); }
  async sync(sourceId: string, key: string, expected: { propertyId?: string; provider?: Provider } = {}) {
    const lease = await this.store.beginSync(sourceId, key);
    if ('result' in lease) return lease.result;
    try {
      if (lease.source.id !== sourceId || (expected.propertyId && lease.source.propertyId !== expected.propertyId)) throw new CalendarError('NOT_FOUND', 404);
      if (expected.provider && lease.source.provider !== expected.provider) throw new CalendarError('VALIDATION_ERROR', 400);
      if (!lease.source.enabled) throw new CalendarError('SOURCE_DISABLED', 409);
      const { source } = lease;
      const fetched: FetchResult = await this.fetcher(revealUrl(source.encryptedUrl, source.provider, source.propertyId), source.provider, source);
      if (fetched.status === 304 && !source.etag && !source.lastModified) throw new CalendarError('FETCH_HTTP');
      const snapshot = fetched.status === 304 ? null : normalize(fetched.body!, source.provider, source.timezone);
      // Partial snapshots are surfaced, but no event/job writes or validators are accepted by the RPC.
      return await this.store.finishSync(lease, snapshot, snapshot && !snapshot.complete ? {} : { etag: fetched.etag, lastModified: fetched.lastModified });
    } catch (error) {
      // Failure bookkeeping must not replace the original safe fetch/reconciliation error.
      // If the DB is unavailable the bounded lease expires and a later fresh-key retry can recover.
      try { await this.store.failSync(lease, safeCode(error)); } catch { /* Never expose transport details. */ }
      throw new CalendarError(safeCode(error), error instanceof CalendarError ? error.status : 502);
    }
  }
  async scheduled(key: string) {
    const results: { sourceId: string; status: 'success' | 'failed'; errorCode?: string }[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.store.enabledSourceIds(cursor);
      for (const id of page.ids) {
        try {
          const outcome = await this.sync(id, `${key}:${id}`);
          results.push(outcome.status === 'partial'
            ? { sourceId: id, status: 'failed', errorCode: 'PARTIAL_CALENDAR' }
            : { sourceId: id, status: 'success' });
        }
        catch (error) { results.push({ sourceId: id, status: 'failed', errorCode: safeCode(error) }); }
      }
      cursor = page.nextCursor || undefined;
    } while (cursor);
    return results;
  }
}
