import 'server-only';
import { requireAdmin } from '../auth/session';
import { CalendarService } from './service';
import { rpcStore, serviceRpc } from './store';
export async function adminCalendar() {
  const admin = await requireAdmin();
  return new CalendarService(rpcStore(serviceRpc(), admin.id));
}
export function trustedCalendar() { return new CalendarService(rpcStore(serviceRpc(), null)); }
