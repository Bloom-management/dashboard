import {response} from '@/server/db/http';
import {calendarAddCleanings} from '@/server/calendar/add';
export const runtime='nodejs';
export const GET=(request:Request)=>response(()=>calendarAddCleanings(request),request);
