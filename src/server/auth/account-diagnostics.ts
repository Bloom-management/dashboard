import 'server-only';
import type { SessionUser } from '../../contracts';

const networkCodes = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_OVERFLOW', 'ABORT_ERR', 'ERR_INVALID_URL', 'ERR_INVALID_ARG_TYPE',
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID',
]);
const errorNames = new Set(['Error', 'TypeError', 'SyntaxError', 'AbortError', 'TimeoutError', 'AggregateError', 'HeadersOverflowError']);
export type FailureSummary = { names: string[]; codes: string[] };
function field(value: unknown, key: string): unknown {
  try { return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined; }
  catch { return undefined; }
}
/** No messages, details, stacks, URLs, addresses, headers, tokens, keys or user IDs. */
export function safeFailure(error: unknown): FailureSummary {
  const names = new Set<string>(); const codes = new Set<string>(); const seen = new Set<unknown>();
  let visited = 0;
  function visit(value: unknown, depth: number) {
    if (!value || depth > 4 || seen.has(value) || visited++ >= 16) return;
    seen.add(value);
    const name = field(value, 'name'); const code = field(value, 'code');
    if (typeof name === 'string' && errorNames.has(name)) names.add(name);
    if (typeof code === 'string' && networkCodes.has(code)) codes.add(code);
    visit(field(value, 'cause'), depth + 1);
    const errors = field(value, 'errors');
    if (Array.isArray(errors)) for (const inner of errors.slice(0, 8)) visit(inner, depth + 1);
  }
  visit(error, 0);
  return { names: [...names].sort(), codes: [...codes].sort() };
}
function safeDatabaseCode(value: unknown): string | null {
  return typeof value === 'string' && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(value) ? value : null;
}
export function isSessionUser(value: unknown): value is SessionUser {
  const id = field(value, 'id'); const role = field(value, 'role'); const city = field(value, 'approvedCityId');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && uuid.test(id) && ['admin', 'owner', 'cleaner'].includes(String(role)) &&
    typeof field(value, 'displayName') === 'string' && (city === null || (typeof city === 'string' && uuid.test(city)));
}
export type AccountDiagnostic = {
  requestId: string;
  phase: 'configuration' | 'fetch_exception' | 'response_processing_failure' | 'client_exception_before_fetch' |
    'http_error' | 'missing_account' | 'mapped' | 'invalid_account_payload';
  configurationField: 'clerk_secret' | 'supabase_url' | 'publishable_key' | 'clerk_integration_claim' | 'client_initialization' | null;
  targetKind: 'loopback_ipv4' | 'loopback_ipv6' | 'loopback_hostname' | 'remote' | 'invalid' | 'unset';
  targetPort: number | null;
  verifiedClerkSession: boolean;
  tokenPresent: boolean;
  authenticatedRoleClaim: boolean | null;
  attempts: number;
  httpStatus: number | null;
  sdkStatus: number | null;
  databaseCode: string | null;
  originalTokenForwarded: boolean | null;
  missingAccount: boolean;
  mapped: boolean;
  failure: FailureSummary;
};
type LookupResult = { data: unknown; error: { message: string; code?: string } | null; status: number };
export function accountDiagnostics(
  emit: (event: AccountDiagnostic) => void = event => console.info('[Bloom account diagnostic]', JSON.stringify(event)),
) {
  let state: AccountDiagnostic = {
    requestId: crypto.randomUUID(), phase: 'client_exception_before_fetch', configurationField: null,
    targetKind: 'unset', targetPort: null, verifiedClerkSession: false, tokenPresent: false, authenticatedRoleClaim: null, attempts: 0, httpStatus: null, sdkStatus: null,
    databaseCode: null, originalTokenForwarded: null, missingAccount: false, mapped: false,
    failure: { names: [], codes: [] },
  };
  const snapshot = (): AccountDiagnostic => structuredClone(state);
  const publish = () => { try { emit(snapshot()); } catch { /* Logging must not break authentication. */ } };
  return {
    snapshot,
    verifiedSession() { state.verifiedClerkSession = true; state.tokenPresent = true; },
    tokenConfigurationAccepted() { state.authenticatedRoleClaim = true; },
    configurationFailure(configurationField: AccountDiagnostic['configurationField'], error?: unknown) {
      state = { ...state, phase: 'configuration', configurationField, failure: safeFailure(error) };
      if (configurationField === 'clerk_integration_claim') state.authenticatedRoleClaim = false;
      publish();
    },
    observeFetch(target: string, originalToken: string, implementation: typeof fetch = globalThis.fetch): typeof fetch {
      try {
        const url = new URL(target);
        state.targetKind = url.hostname === '127.0.0.1' ? 'loopback_ipv4' : url.hostname === '[::1]' ? 'loopback_ipv6' :
          url.hostname === 'localhost' ? 'loopback_hostname' : 'remote';
        state.targetPort = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
      } catch { state.targetKind = 'invalid'; }
      return async (input, init) => {
        state = { ...state, attempts: state.attempts + 1, httpStatus: null, failure: { names: [], codes: [] } };
        try {
          const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
          state.originalTokenForwarded = headers.get('authorization') === `Bearer ${originalToken}`;
          const result = await implementation(input, init);
          state.httpStatus = result.status;
          return result;
        } catch (error) {
          state.phase = 'fetch_exception'; state.failure = safeFailure(error); publish(); throw error;
        }
      };
    },
    lookup(result: LookupResult) {
      const missing = result.status === 400 && result.error?.code === 'P0001' && result.error.message === 'UNAUTHENTICATED';
      state.sdkStatus = result.status;
      state.databaseCode = result.status > 0 ? safeDatabaseCode(result.error?.code) : null;
      state.missingAccount = missing;
      state.mapped = !result.error && result.status >= 200 && result.status < 300 && isSessionUser(result.data);
      if (result.status === 0) {
        state.phase = state.httpStatus !== null ? 'response_processing_failure' : state.attempts ? 'fetch_exception' : 'client_exception_before_fetch';
        // The SDK flattens response-processing errors. Extract only a known error class prefix.
        const prefix = result.error?.message.split(':', 1)[0];
        if (prefix && errorNames.has(prefix) && !state.failure.names.includes(prefix)) state.failure.names.push(prefix);
      } else state.phase = missing ? 'missing_account' : result.error ? (result.status >= 200 && result.status < 300 ? 'response_processing_failure' : 'http_error') : state.mapped ? 'mapped' : 'invalid_account_payload';
      if (process.env.NODE_ENV === 'development' || !state.mapped) publish();
      return snapshot();
    },
  };
}
