import { adminCalendar } from '../../../../../server/calendar/runtime';
import { calendarResponse } from '../../../../../server/calendar/http';
import { mutation, uuid, choice, text } from '../../../../../server/db/http';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  return calendarResponse(async () => {
    const service = await adminCalendar();
    const cursor = new URL(request.url).searchParams.get('cursor');
    return service.listSources(cursor ? uuid(cursor) : undefined);
  });
}
export async function POST(request: Request) {
  return calendarResponse(async () => {
    const service = await adminCalendar();
    const { body, key } = await mutation(request, ['propertyId', 'provider', 'url']);
    return service.addSource(uuid(body.propertyId), choice(body.provider, ['airbnb', 'vrbo']), text(body.url, 4096), key);
  });
}
