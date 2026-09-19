import { calendarResponse } from '@/server/calendar/http';
import { mutation,uuid } from '@/server/db/http';
import { propertyCalendar } from '@/server/admin/property-calendar';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string;sourceId:string}>}){return calendarResponse(async()=>{
 const {id,sourceId}=await context.params;const service=await propertyCalendar(uuid(id));
 const {key}=await mutation(request,[]);return service.sync(uuid(sourceId),key);
});}
