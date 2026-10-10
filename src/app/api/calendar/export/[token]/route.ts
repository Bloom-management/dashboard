import { serviceRpc } from '@/server/calendar/store';
import { serializeBloomCalendar, type BloomExportEvent } from '@/server/calendar/export';
import { exportTokenHash } from '@/server/calendar/manual-http';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const missing = () => new Response('Calendar not found.', { status: 404, headers });
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const hash = exportTokenHash((await context.params).token);
  if (!hash) return missing();
  try {
    const feed = await serviceRpc()<{ events: BloomExportEvent[] } | null>('bloom_calendar_export_feed', { p_token_hash: hash });
    if (!feed) return missing();
    return new Response(serializeBloomCalendar(feed.events), { headers: { ...headers, 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="bloom-availability.ics"' } });
  } catch {
    // The subscription capability must never appear in logs or error responses.
    return new Response('Calendar temporarily unavailable.', { status: 503, headers });
  }
}
