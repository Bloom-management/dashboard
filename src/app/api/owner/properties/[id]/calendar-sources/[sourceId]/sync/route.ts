import { calendarResponse } from '@/server/calendar/http';
import { mutation, uuid } from '@/server/db/http';
import { ownerPropertyCalendar } from '@/server/calendar/owner-runtime';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string; sourceId: string }> }) {
  return calendarResponse(async () => {
    const { id, sourceId } = await context.params;
    const service = await ownerPropertyCalendar(uuid(id));
    const { key } = await mutation(request, []);
    return service.sync(uuid(sourceId), key);
  });
}
