import {saveAndSync} from '@/server/calendar/save-and-sync';
import { calendarResponse } from '@/server/calendar/http';
import { mutation, uuid, choice, text } from '@/server/db/http';
import { propertyCalendar } from '@/server/admin/property-calendar';
export const runtime='nodejs';
export const maxDuration=60;
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){return calendarResponse(async()=>{
 const service=await propertyCalendar(uuid((await context.params).id));
 const cursor=new URL(request.url).searchParams.get('cursor');return service.list(cursor?uuid(cursor):null);
});}
export async function POST(request:Request,context:Context){return calendarResponse(async()=>{
 const service=await propertyCalendar(uuid((await context.params).id));
 const {body,key}=await mutation(request,['provider','url']);return saveAndSync(()=>service.add(choice(body.provider,['airbnb','vrbo']),text(body.url,4096),key),service.sync,key);
});}
