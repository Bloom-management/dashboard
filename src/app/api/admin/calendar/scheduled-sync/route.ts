import { trustedCalendar } from '../../../../../server/calendar/runtime';
import { authenticateSchedule, calendarResponse, idempotencyKey } from '../../../../../server/calendar/http';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return calendarResponse(async () => {
    authenticateSchedule(request);
    return trustedCalendar().scheduled(idempotencyKey(request));
  });
}
