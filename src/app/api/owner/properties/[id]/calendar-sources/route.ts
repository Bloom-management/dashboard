import {saveAndSync} from '@/server/calendar/save-and-sync';
import { CalendarError } from '@/server/calendar/errors';
import { calendarResponse } from '@/server/calendar/http';
import { mutation, uuid, text } from '@/server/db/http';
import { ownerPropertyCalendar } from '@/server/calendar/owner-runtime';
export const runtime = 'nodejs';
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return calendarResponse(async () => {
    const service = await ownerPropertyCalendar(uuid((await context.params).id));
    const cursor = new URL(request.url).searchParams.get('cursor');
    return service.list(cursor ? uuid(cursor) : null);
  });
}
export async function POST(request: Request, context: Context) {
  return calendarResponse(async () => {
    const service = await ownerPropertyCalendar(uuid((await context.params).id));
    const { body, key } = await mutation(request, ['url','provider']);
    const provider=body.provider??'airbnb';
    if(provider!=='airbnb'&&provider!=='vrbo')throw new CalendarError('VALIDATION_ERROR',400);
    return saveAndSync(()=>service.add(text(body.url, 4096), key, provider),service.sync,key);
  });
}
