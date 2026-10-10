import { choice, mutation, response, uuid } from '@/server/db/http';
import { BackendError } from '@/server/db/errors';
import { userRpc } from '@/server/db/rpc';
import { calendarActions, calendarActionResponse, type CalendarActionResult } from '@/server/calendar/manual-http';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return calendarActionResponse(await response(async () => {
    const { body, key } = await mutation(request, ['action', 'data']);
    if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new BackendError('VALIDATION_ERROR');
    return userRpc<CalendarActionResult>('bloom_property_calendar_action', {
      p_property: uuid((await context.params).id), p_action: choice(body.action, calendarActions), p_data: body.data, p_key: key,
    });
  }));
}
