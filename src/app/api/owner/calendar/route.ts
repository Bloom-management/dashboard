// Conditional calendar responses are validated after current-account authorization.
import {currentUser} from '../../../../server/auth/session';
import {adminOwnerCalendar} from '../../../../server/owner/admin-view';
import {response,dateRange} from '../../../../server/db/http';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  return response(async()=>{if((await currentUser()).role==='admin')return adminOwnerCalendar(...dateRange(request));
    const {ownerCalendar}=await import('../../../../server/jobs/operations');return ownerCalendar(...dateRange(request));},request);
}
