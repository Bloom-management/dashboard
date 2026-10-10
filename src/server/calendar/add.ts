import 'server-only';
import type {CalendarAddOptions,CalendarAddAvailability,CalendarAddCleaning,CalendarAddResponse,CalendarAddInput} from '@/contracts/calendar-add';
import {BackendError} from '../db/errors';
import {userRpc} from '../db/rpc';
import {mutation,uuid,integer,choice} from '../db/http';

function localDate(value:unknown):string {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new BackendError('VALIDATION_ERROR');
 return value;
}
function optionalText(value:unknown,max=4000):string {if(typeof value!=='string'||value.length>max)throw new BackendError('VALIDATION_ERROR');return value;}
function bool(value:unknown):boolean {if(typeof value!=='boolean')throw new BackendError('VALIDATION_ERROR');return value;}
function time(value:unknown):string {if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))throw new BackendError('VALIDATION_ERROR');return value;}
export function calendarAddRange(request:Request):[string,string]{
 const query=new URL(request.url).searchParams;const from=localDate(query.get('from')),to=localDate(query.get('to'));
 if(to<from||Date.parse(to)-Date.parse(from)>2192*86400000)throw new BackendError('VALIDATION_ERROR');return [from,to];
}
export const calendarAddOptions=()=>userRpc<CalendarAddOptions>('bloom_calendar_add_options');
export function calendarAddAvailability(request:Request){const [from,to]=calendarAddRange(request);return userRpc<CalendarAddAvailability>('bloom_calendar_add_availability',{p_property:uuid(new URL(request.url).searchParams.get('propertyId')),p_from:from,p_to:to});}
export function calendarAddCleanings(request:Request){const [from,to]=calendarAddRange(request);return userRpc<CalendarAddCleaning[]>('bloom_calendar_add_cleanings',{p_from:from,p_to:to});}
export async function calendarAdd(request:Request,review=false){
 const {body,key}=await mutation(request,['kind','propertyId','action','date','startTime','endTime','comments','management','capacity','totalCents','cleaners','existingCleaningId','expectedVersion','inStayAcknowledged','assignedImpactAcknowledged','checkIn','checkout','note','checkoutResolution','reviewToken','additionalAcknowledged']);
 const kind=choice(body.kind,['cleaning','booking'] as const),propertyId=uuid(body.propertyId);let input:CalendarAddInput;
 if(kind==='cleaning'){
  if(!Array.isArray(body.cleaners)||body.cleaners.length>20)throw new BackendError('VALIDATION_ERROR');
  const cleaners=body.cleaners.map(x=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!['id','individualAmountCents'].includes(k)))throw new BackendError('VALIDATION_ERROR');return {id:uuid(x.id),individualAmountCents:x.individualAmountCents==null?null:integer(x.individualAmountCents,1,100000000)};});
  input={kind,propertyId,action:choice(body.action,['create','move'] as const),date:localDate(body.date),startTime:time(body.startTime),endTime:time(body.endTime),comments:optionalText(body.comments),management:choice(body.management,['bloom','private'] as const),capacity:integer(body.capacity,1,20),totalCents:integer(body.totalCents,20,100000000),cleaners,inStayAcknowledged:bool(body.inStayAcknowledged),assignedImpactAcknowledged:bool(body.assignedImpactAcknowledged),additionalAcknowledged:body.additionalAcknowledged===true};
  if(input.endTime<=input.startTime)throw new BackendError('VALIDATION_ERROR');
  if(input.action==='move'){input.existingCleaningId=uuid(body.existingCleaningId);input.expectedVersion=integer(body.expectedVersion,1,2147483647);}
 }else{
  const x=body.checkoutResolution;if(!x||typeof x!=='object'||Array.isArray(x))throw new BackendError('VALIDATION_ERROR');
  const resolution=x as Record<string,unknown>;if(Object.keys(resolution).some(k=>!['action','cleaningId','expectedVersion'].includes(k)))throw new BackendError('VALIDATION_ERROR');
  const action=choice(resolution.action,['create','reuse','additional'] as const);
  input={kind,propertyId,checkIn:localDate(body.checkIn),checkout:localDate(body.checkout),note:optionalText(body.note,2000),assignedImpactAcknowledged:body.assignedImpactAcknowledged===true,checkoutResolution:action!=='reuse'?{action}:{action,cleaningId:uuid(resolution.cleaningId),expectedVersion:integer(resolution.expectedVersion,1,2147483647)}};
  if(input.checkout<=input.checkIn||Date.parse(input.checkout)-Date.parse(input.checkIn)>730*86400000)throw new BackendError('VALIDATION_ERROR');
 }
 if(review)return userRpc<{reviewToken:string}>('bloom_calendar_add_review',{p_input:input});
 if(typeof body.reviewToken!=='string'||body.reviewToken.length>200)throw new BackendError('VALIDATION_ERROR');input.reviewToken=body.reviewToken;
 return userRpc<CalendarAddResponse>('bloom_calendar_add',{p_input:input,p_key:key});
}
