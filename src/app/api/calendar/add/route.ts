import {response} from '@/server/db/http';
import {calendarAdd} from '@/server/calendar/add';
export const runtime='nodejs';
export const POST=(request:Request)=>response(()=>calendarAdd(request));
