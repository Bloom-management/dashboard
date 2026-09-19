import { CalendarError, actions } from './errors';
import { CalendarService } from './service';
import { rpcStore, type Rpc } from './store';
import type { SourceHealth } from './types';
import type { fetchCalendar } from './fetch';

export type PropertySourceHealth = Pick<SourceHealth,
  'id' | 'propertyId' | 'provider' | 'enabled' | 'lastSuccessAt' | 'lastAttemptAt'> & { errorMessage: string | null };

/** actor must come from requireAdmin(). The database independently rechecks that actor.
 * Source property identity is immutable in migration 007, so scoped membership remains
 * valid between the read and begin-sync RPC (which still rechecks enabled/actor state). */
export function propertyCalendarService(propertyId: string, actor: string, rpc: Rpc, fetcher?: typeof fetchCalendar) {
  const health = (source: SourceHealth): PropertySourceHealth => {
    if (source.propertyId !== propertyId) throw new CalendarError('NOT_FOUND', 404);
    return {
      id: source.id, propertyId, provider: source.provider, enabled: source.enabled,
      lastSuccessAt: source.lastSuccessAt, lastAttemptAt: source.lastAttemptAt,
      errorMessage: source.errorCode
        ? (Object.hasOwn(actions, source.errorCode) ? actions[source.errorCode] : actions.SYNC_FAILED) : null,
    };
  };
  const list = async (cursor: string | null = null) => {
    const page = await rpc<{ items: SourceHealth[]; nextCursor: string | null }>('bloom_calendar_property_sources', {
      p_actor: actor, p_property: propertyId, p_cursor: cursor,
    });
    // Allowlist both the page and row shapes; never spread upstream database objects to clients.
    return { items: page.items.map(health), nextCursor: page.nextCursor };
  };
  const service = () => new CalendarService(rpcStore(rpc, actor), fetcher);
  return {
    list,
    add: async (provider: 'airbnb' | 'vrbo', url: string, key: string) => {
      await list(); // Verify the path property before encrypting or writing anything.
      return health(await service().addSource(propertyId, provider, url, key));
    },
    sync: async (sourceId: string, key: string) => {
      let cursor: string | null = null;
      do {
        const page = await list(cursor);
        const source = page.items.find(s => s.id === sourceId);
        if (source) {
          // Disabled synthetic sources can have deliberately unusable ciphertext. Never decrypt/fetch them.
          if (!source.enabled) throw new CalendarError('CONFLICT', 409);
          return service().sync(sourceId, key, { propertyId });
        }
        if (page.nextCursor && cursor && page.nextCursor <= cursor) throw new CalendarError('CONFIGURATION_ERROR', 503);
        cursor = page.nextCursor;
      } while (cursor);
      throw new CalendarError('NOT_FOUND', 404);
    },
  };
}
