import type { CalendarStore, Lease, SourceHealth, SyncOutcome } from './types';
import { CalendarError, actions } from './errors';
export type Rpc = <T>(name: string, args: Record<string, unknown>) => Promise<T>;
/** actor is set ONLY from requireAdmin(), or null for an authenticated scheduler/local trusted command. */
export function rpcStore(rpc: Rpc, actor: string | null): CalendarStore {
  const call = <T>(name: string, args: Record<string, unknown>) => rpc<T>(name, { ...args, p_actor: actor });
  const health = (value: SourceHealth): SourceHealth => ({ id: value.id, propertyId: value.propertyId, provider: value.provider,
    enabled: value.enabled, lastSuccessAt: value.lastSuccessAt, lastAttemptAt: value.lastAttemptAt,
    errorCode: value.errorCode && Object.hasOwn(actions, value.errorCode) ? value.errorCode : value.errorCode ? 'SYNC_FAILED' : null,
    action: value.errorCode ? (Object.hasOwn(actions, value.errorCode) ? actions[value.errorCode] : actions.SYNC_FAILED) : null });
  return {
    async addSource(input, key) { return health(await call<SourceHealth>('bloom_calendar_add_source', { p_input: input, p_key: key })); },
    async listSources(cursor) {
      const page = await call<{ items: SourceHealth[]; nextCursor: string | null }>('bloom_calendar_sources', { p_cursor: cursor ?? null });
      return { items: page.items.map(health), nextCursor: page.nextCursor };
    },
    beginSync: (sourceId, key) => call<Lease | { result: SyncOutcome }>('bloom_calendar_begin_sync', { p_source: sourceId, p_key: key }),
    finishSync: (lease, snapshot, validators) => call<SyncOutcome>('bloom_calendar_finish_sync', {
      p_source: lease.source.id, p_run: lease.runId, p_version: lease.version, p_snapshot: snapshot, p_validators: validators,
    }),
    failSync: (lease, code) => call<void>('bloom_calendar_fail_sync', { p_source: lease.source.id, p_run: lease.runId, p_version: lease.version, p_code: Object.hasOwn(actions, code) ? code : 'SYNC_FAILED' }),
    enabledSourceIds: cursor => call('bloom_calendar_enabled_sources', { p_cursor: cursor ?? null }),
  };
}
/** Standalone RPC transport for the local trusted command. Missing RPCs/configuration fail closed. */
export function serviceRpc(): Rpc {
  // Configuration belongs to an attempted calendar operation, not module/factory initialization.
  // Account lookup and unrelated property reads must not depend on ingestion credentials.
  return async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    try {
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!base || !key || key.startsWith('replace_')) throw new CalendarError('CONFIGURATION_ERROR', 503);
      const url = new URL(base);
      if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new CalendarError('CONFIGURATION_ERROR', 503);
      const response = await fetch(new URL(`/rest/v1/rpc/${name}`, url), { method: 'POST', headers: {
        apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      }, body: JSON.stringify(args), signal: AbortSignal.timeout(20_000), redirect: 'error' });
      if (!response.ok) {
        // PostgreSQL PTxxx errors use this exact allowlist; SQL detail is never exposed.
        let message: unknown;
        try { message = (await response.json()).message; } catch { /* Unknown upstream body fails closed. */ }
        const statuses: Record<string,number> = {VALIDATION_ERROR:400,UNAUTHENTICATED:401,FORBIDDEN:403,NOT_FOUND:404,CONFLICT:409,CONFIGURATION_ERROR:503};
        if(typeof message==='string' && Object.hasOwn(statuses,message) && response.status===statuses[message]) throw new CalendarError(message,response.status);
        throw new CalendarError('CONFIGURATION_ERROR',503);
      }
      if(response.status===204)return undefined as T;
      return await response.json() as T;
    } catch (error) { if (error instanceof CalendarError) throw error; throw new CalendarError('CONFIGURATION_ERROR', 503); }
  };
}
