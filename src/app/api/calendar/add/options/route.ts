import {response} from '@/server/db/http';
import {calendarAddOptions} from '@/server/calendar/add';
export const runtime='nodejs';
export const GET=()=>response(calendarAddOptions);
