import { randomUUID, timingSafeEqual } from 'node:crypto';
import { CalendarError, actions } from './errors';
export function authenticateSchedule(request: Request) {
  const secret = process.env.CALENDAR_SYNC_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith('replace_')) throw new CalendarError('CONFIGURATION_ERROR', 503);
  const received = Buffer.from(request.headers.get('authorization') || ''); const expected = Buffer.from(`Bearer ${secret}`);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new CalendarError('UNAUTHENTICATED', 401);
}
export function idempotencyKey(request: Request) {
  const key = request.headers.get('idempotency-key');
  if (!key || !/^[\w:.-]{1,160}$/.test(key)) throw new CalendarError('VALIDATION_ERROR', 400);
  return key;
}
export async function calendarResponse(operation: () => Promise<unknown>) {
  const requestId = randomUUID(); const headers = { 'Cache-Control': 'no-store', 'X-Request-Id': requestId };
  try { return Response.json({ data: await operation() }, { headers }); }
  catch (error) {
    // Recognize only allowlisted backend error codes; never serialize exception text or causes.
    const code = error instanceof CalendarError ? error.code :
      error instanceof Error && 'code' in error && ['UNAUTHENTICATED','FORBIDDEN','NOT_FOUND','VALIDATION_ERROR','CONFIGURATION_ERROR','CONFLICT'].includes(String(error.code)) ? String(error.code) : 'CONFIGURATION_ERROR';
    const status = error instanceof CalendarError ? error.status : ({ UNAUTHENTICATED:401, FORBIDDEN:403, NOT_FOUND:404, VALIDATION_ERROR:400, CONFLICT:409 }[code] || 503);
    const apiCode = code in actions && code !== 'CONFIGURATION_ERROR' ? 'SOURCE_UNAVAILABLE' : code;
    return Response.json({ error: { code: apiCode, message: actions[code] || 'The calendar operation could not be completed.', requestId } }, { status, headers });
  }
}
