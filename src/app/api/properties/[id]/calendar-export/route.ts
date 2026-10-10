import { choice, mutation, response, uuid } from '@/server/db/http';
import { userRpc } from '@/server/db/rpc';
import { calendarExportUrl } from '@/server/calendar/manual-http';
export const runtime = 'nodejs';
type Settings = { enabled: boolean; token: string | null; lastFetchedAt: string | null; ownerConfirmedAt: string | null };
async function settings(id: string, action: string, key: string | null) {
  const value = await userRpc<Settings>('bloom_calendar_export_settings', { p_property: uuid(id), p_action: action, p_key: key });
  return { enabled: value.enabled, url: calendarExportUrl(value.token, process.env.NEXT_PUBLIC_APP_URL),
    lastFetchedAt: value.lastFetchedAt, ownerConfirmedAt: value.ownerConfirmedAt };
}
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return response(async () => settings((await context.params).id, 'status', null));
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return response(async () => {
    const { body, key } = await mutation(request, ['action']);
    return settings((await context.params).id, choice(body.action, ['create', 'regenerate', 'disable', 'confirm'] as const), key);
  });
}
