import { BackendError } from './errors';

/**
 * One structured server log line per failed (5xx) API request, keyed by the reference ID shown
 * to the user, so a reported "Reference: <id>" can be found in the Vercel runtime logs.
 *
 * Logs identifiers only: error codes, the Postgres/PostgREST code, the RPC or table name and
 * code locations. Never exception messages, SQL details, request bodies, tokens or user IDs.
 */
export type RequestFailureLog = {
  requestId: string;
  status: number;
  code: string;
  databaseCode: string | null;
  source: string | null;
  errorName: string | null;
  /** Error names and identifier-shaped codes (ECONNRESET, UND_ERR_SOCKET…) along the `cause` chain. */
  causes: string[];
  at: string[];
};

const databaseCodePattern = /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/;
const sourcePattern = /^[a-z][a-z0-9_:.-]{0,80}$/i;
const identifierPattern = /^[A-Za-z][A-Za-z0-9_]{1,40}$/;

/** Names and codes only; messages are never read. */
function causes(error: unknown): string[] {
  const found = new Set<string>();
  let current: unknown = error;
  for (let depth = 0; current && typeof current === 'object' && depth < 5; depth++) {
    const { name, code } = current as { name?: unknown; code?: unknown };
    if (typeof name === 'string' && identifierPattern.test(name)) found.add(name);
    if (typeof code === 'string' && identifierPattern.test(code)) found.add(code);
    try { current = (current as { cause?: unknown }).cause; } catch { break; }
  }
  return [...found];
}

/** Up to four code locations, trimmed to the app-relative path (route bundles name the route). */
function locations(error: unknown): string[] {
  const stack = error instanceof Error && typeof error.stack === 'string' ? error.stack : '';
  return stack.split('\n').slice(1)
    .map(line => line.match(/\(?((?:[^\s()]*?)(?:\.next\/server\/|\/src\/)[^\s()]*?:\d+:\d+)\)?\s*$/)?.[1] ?? '')
    .filter(Boolean)
    .map(path => path.replace(/^.*?(\.next\/server\/|src\/)/, '$1'))
    .slice(0, 4);
}

export function describeRequestFailure(requestId: string, status: number, code: string, error: unknown): RequestFailureLog {
  const backend = error instanceof BackendError ? error : null;
  const databaseCode = backend?.databaseCode && databaseCodePattern.test(backend.databaseCode) ? backend.databaseCode : null;
  const source = backend?.source && sourcePattern.test(backend.source) ? backend.source : null;
  const name = error instanceof Error ? error.name : null;
  return {
    requestId, status, code, databaseCode, source,
    errorName: name && /^[A-Za-z]{1,40}$/.test(name) ? name : null,
    causes: causes(error),
    at: locations(error),
  };
}

export function logRequestFailure(requestId: string, status: number, code: string, error: unknown) {
  if (status < 500) return;
  try { console.error('[Bloom request failure]', JSON.stringify(describeRequestFailure(requestId, status, code, error))); }
  catch { console.error('[Bloom request failure]', JSON.stringify({ requestId, status, code })); }
}
