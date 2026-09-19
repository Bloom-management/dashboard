import 'server-only';
import { requireAdmin } from '../auth/session';
import { serviceRpc } from '../calendar/store';
import { propertyCalendarService } from '../calendar/property';

export async function propertyCalendar(propertyId: string) {
  const actor = await requireAdmin();
  return propertyCalendarService(propertyId, actor.id, serviceRpc());
}
