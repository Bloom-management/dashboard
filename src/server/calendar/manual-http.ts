import { createHash } from 'node:crypto';

export const calendarActions = ['preview', 'create_cleaning', 'move_cleaning', 'create_booking', 'edit_booking', 'cancel_booking', 'resolve_return'] as const;
export type CalendarActionResult = { ok: true; [key: string]: unknown } | { ok: false; conflict: { code: string; message: string; details?: Record<string, unknown> } };

/** Only structured, application-authored conflicts may cross this boundary; never SQL errors. */
export async function calendarActionResponse(result: Response): Promise<Response> {
  if (!result.ok) return result;
  const body = await result.clone().json() as { data: CalendarActionResult };
  if (body.data.ok !== false) return result;
  const conflict = body.data.conflict;
  return Response.json({ error: { code: 'CONFLICT', message: conflict.message,
    requestId: result.headers.get('X-Request-Id'), details: { ...conflict.details, reason: conflict.code } } },
  { status: 409, headers: result.headers });
}

export function exportTokenHash(segment: string): string | null {
  if (!/^[a-f0-9]{64}\.ics$/.test(segment)) return null;
  return createHash('sha256').update(segment.slice(0, -4), 'utf8').digest('hex');
}
export function calendarExportUrl(token: string | null, base: string | undefined): string | null {
  if (!token) return null;
  if (!/^[a-f0-9]{64}$/.test(token) || !base) throw new Error('Calendar export configuration unavailable');
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Calendar export requires HTTPS');
  return new URL(`/api/calendar/export/${token}.ics`, url.origin).href;
}
