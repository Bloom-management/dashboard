import { adminCalendar } from '../../../../../../../server/calendar/runtime';
import { calendarResponse } from '../../../../../../../server/calendar/http';
import { mutation, uuid } from '../../../../../../../server/db/http';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return calendarResponse(async () => {
    const service = await adminCalendar();
    const { key } = await mutation(request, []);
    return service.sync(uuid((await context.params).id), key);
  });
}
