import type { OwnerSource } from '../../contracts/owner-hub';
import { CalendarError } from './errors';
import { propertyCalendarService, type PropertySourceHealth } from './property';
import type { Rpc } from './store';
import type { Lease, SyncOutcome } from './types';
import type { fetchCalendar } from './fetch';

/** Verified owner UUID only. Every owner RPC independently checks current membership
 * and route-bound property under its transaction lock, including finish and failure. */
export function ownerPropertyCalendarService(propertyId: string, actor: string, rpc: Rpc, fetcher?: typeof fetchCalendar) {
  const names: Record<string, string> = {
    bloom_calendar_property_sources: 'bloom_owner_calendar_sources',
    bloom_calendar_add_source: 'bloom_owner_calendar_add_source',
    bloom_calendar_begin_sync: 'bloom_owner_calendar_begin_sync',
    bloom_calendar_finish_sync: 'bloom_owner_calendar_finish_sync',
    bloom_calendar_fail_sync: 'bloom_owner_calendar_fail_sync',
  };
  const scoped: Rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    if (!Object.hasOwn(names, name)) throw new CalendarError('FORBIDDEN', 403);
    const result = await rpc<T>(names[name], { ...args, p_actor: actor, p_property: propertyId });
    if (name === 'bloom_calendar_begin_sync') {
      const lease = result as Lease | { result: SyncOutcome };
      if (!('result' in lease) && !['airbnb','vrbo'].includes(lease.source.provider)) throw new CalendarError('NOT_FOUND', 404);
    }
    return result;
  };
  const service = propertyCalendarService(propertyId, actor, scoped, fetcher);
  const safe = (source: PropertySourceHealth): OwnerSource => ({ id: source.id, propertyId: source.propertyId,
    provider: source.provider, enabled: source.enabled, lastSuccessAt: source.lastSuccessAt,
    lastAttemptAt: source.lastAttemptAt, message: source.errorMessage });
  return {
    async list(cursor: string | null = null) { const page = await service.list(cursor); return { items: page.items.map(safe), nextCursor: page.nextCursor }; },
    async add(url: string, key: string, provider: 'airbnb'|'vrbo' = 'airbnb') { return safe(await service.add(provider, url, key)); },
    async sync(sourceId: string, key: string) {
      // Verify source membership before requesting a sync lease.
      let cursor: string | null = null;
      do {
        const page = await service.list(cursor);
        const source = page.items.find(item => item.id === sourceId);
        if (source) {
          if (!['airbnb','vrbo'].includes(source.provider)) throw new CalendarError('NOT_FOUND', 404);
          return service.sync(sourceId, key);
        }
        if (page.nextCursor && cursor && page.nextCursor <= cursor) throw new CalendarError('CONFIGURATION_ERROR', 503);
        cursor = page.nextCursor;
      } while (cursor);
      throw new CalendarError('NOT_FOUND', 404);
    },
  };
}
