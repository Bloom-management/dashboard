import {response} from '@/server/db/http';
import {calendarAddAvailability} from '@/server/calendar/add';
export const runtime='nodejs';
export const GET=(request:Request)=>response(()=>calendarAddAvailability(request));
