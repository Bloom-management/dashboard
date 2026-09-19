import 'server-only';
import { createHash } from 'node:crypto';
import { BackendError, errorStatus } from './errors';
import type { ApiResult, ErrorCode } from '../../contracts';

export type JsonObject = Record<string, unknown>;
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new BackendError('VALIDATION_ERROR');
  return value;
}
export function text(value: unknown, max = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new BackendError('VALIDATION_ERROR');
  return value;
}
export function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new BackendError('VALIDATION_ERROR');
  return value;
}
export function choice<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new BackendError('VALIDATION_ERROR');
  return value as T;
}
export function dateRange(request: Request): [string, string] {
  const query = new URL(request.url).searchParams;
  const from = query.get('from') ?? ''; const to = query.get('to') ?? '';
  for (const value of [from, to]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new BackendError('VALIDATION_ERROR');
  }
  if (to < from || Date.parse(to) - Date.parse(from) > 92 * 86_400_000) throw new BackendError('VALIDATION_ERROR');
  return [from, to];
}
/** The managed development app serves both loopback names on the configured port.
 * Hosted/production origins stay exact; never trust arbitrary loopback ports or subdomains. */
export function trustedMutationOrigin(origin: string | null, appUrl: string, development: boolean): boolean {
  const configured = new URL(appUrl);
  if (origin === configured.origin) return true;
  if (!development || configured.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(configured.hostname)) return false;
  configured.hostname = configured.hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1';
  return origin === configured.origin;
}
export async function mutation(request: Request, keys: readonly string[]): Promise<{ body: JsonObject; key: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl || appUrl.startsWith('replace_')) throw new BackendError('CONFIGURATION_ERROR');
  if (!trustedMutationOrigin(request.headers.get('origin'), appUrl, process.env.NODE_ENV === 'development') || request.headers.get('sec-fetch-site') === 'cross-site') throw new BackendError('FORBIDDEN');
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new BackendError('VALIDATION_ERROR');
  const key = text(request.headers.get('idempotency-key'), 200);
  // Stream with a hard bound; Content-Length alone is client controlled.
  const reader = request.body?.getReader();
  if (!reader) throw new BackendError('VALIDATION_ERROR');
  let size = 0; const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 16_384) { await reader.cancel(); throw new BackendError('VALIDATION_ERROR'); }
    chunks.push(value);
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new BackendError('VALIDATION_ERROR'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !keys.includes(k))) throw new BackendError('VALIDATION_ERROR');
  return { body: body as JsonObject, key };
}
const messages: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Sign in to continue.', FORBIDDEN: 'This operation is not permitted.', NOT_FOUND: 'Resource not found.',
  VALIDATION_ERROR: 'Check the supplied fields.', CITY_MISMATCH: 'This job is outside your approved city.',
  JOB_FULL: 'Both cleaning slots are filled.', ALREADY_ASSIGNED: 'You are already assigned.',
  WITHDRAWAL_DEADLINE: 'The withdrawal deadline has passed.', INVALID_STATE: 'This operation is unavailable in the current state.',
  REVIEW_REQUIRED: 'This job requires admin review.', PHOTO_COVERAGE_REQUIRED: 'Add a photo for each required room category.',
  CONFLICT: 'The request conflicts with an earlier operation. Refresh and try again.', SOURCE_UNAVAILABLE: 'Calendar source unavailable.',
  CONFIGURATION_ERROR: 'The service is not configured or is unavailable.',
};
export async function response<T>(operation: () => Promise<T>, conditionalRequest?: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    // Authorization and RLS reads always run before considering a client validator.
    const body = { data: await operation() } satisfies ApiResult<T>;
    const headers: Record<string,string> = { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId };
    if (conditionalRequest) {
      headers.ETag = '"' + createHash('sha256').update(JSON.stringify(body)).digest('hex') + '"';
      if (conditionalRequest.headers.get('if-none-match') === headers.ETag) return new Response(null, {status:304,headers});
    }
    return Response.json(body, {headers});
  }
  catch (error) {
    const code = error instanceof BackendError ? error.code : 'CONFIGURATION_ERROR';
    return Response.json({ error: { code, message: messages[code], requestId } } satisfies ApiResult<T>, { status: errorStatus[code], headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId } });
  }
}
