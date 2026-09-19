import 'server-only';
import {authenticatedDatabase,requireAdmin} from '../auth/session';
import {BackendError,databaseError} from '../db/errors';
import {userRpc} from '../db/rpc';
import {propertyCalendarService} from '../calendar/property';
import {serviceRpc} from '../calendar/store';
import {calculateOwnerPerformance} from '../calendar/owner-metrics';
import type {CalendarReviewEntry,CalendarReviewPage,OwnerCalendarBlock} from '../../contracts';
import type {OwnerListing,OwnerListingsPage,OwnerSource,OwnerAnalyticsInput} from '../../contracts/owner-hub';

type Property={id:string;name:string;timezone:string;active:boolean};
/** Actual admin identity, existing admin/user-token RPCs only. Never impersonates an owner. */
async function propertyPage(cursor:string|null,limit=101) {
 await requireAdmin();const {db}=await authenticatedDatabase();
 let query=db.from('properties').select('id,name,timezone,active').order('id').limit(limit);
 if(cursor)query=query.gt('id',cursor);
 const {data,error}=await query;if(error)databaseError(error);return (data??[]) as Property[];
}
async function sources(propertyId:string,actor:string):Promise<OwnerSource[]> {
 const result:OwnerSource[]=[];let cursor:string|null=null;const service=propertyCalendarService(propertyId,actor,serviceRpc());
 do{const page=await service.list(cursor);result.push(...page.items.map(s=>({id:s.id,propertyId:s.propertyId,provider:s.provider,enabled:s.enabled,lastSuccessAt:s.lastSuccessAt,lastAttemptAt:s.lastAttemptAt,message:s.errorMessage})));if(page.nextCursor&&cursor&&page.nextCursor<=cursor)throw new BackendError('CONFIGURATION_ERROR');cursor=page.nextCursor;}while(cursor);
 return result;
}
export async function adminOwnerListings(cursor:string|null):Promise<OwnerListingsPage> {
 const actor=await requireAdmin();const page=await propertyPage(cursor);
 const items:OwnerListing[]=[];
 for(const p of page.slice(0,100)) {
  items.push({id:p.id,name:p.name,timezone:p.timezone,active:p.active,currency:'USD',nightlyGuestRateCents:null,hostPayoutCents:null,supplies:[],suppliesUnavailable:true,sources:await sources(p.id,actor.id)});
 }
 return {items,nextCursor:page.length>100?page[99].id:null};
}
async function allProperties(ids:string[]|null) {
 await requireAdmin();const {db}=await authenticatedDatabase();
 if(ids){const {data,error}=await db.from('properties').select('id,name,timezone,active').in('id',ids).order('id');if(error)databaseError(error);if(data?.length!==ids.length)throw new BackendError('NOT_FOUND');return data as Property[];}
 const rows:Property[]=[];let cursor:string|null=null;
 do{const page=await propertyPage(cursor);rows.push(...page.slice(0,100));cursor=page.length>100?page[99].id:null;if(rows.length>100)throw new BackendError('VALIDATION_ERROR');}while(cursor);
 return rows;
}
async function review(propertyId:string) {
 const rows:CalendarReviewEntry[]=[];let cursor:string|null=null;
 do{const page:CalendarReviewPage=await userRpc('bloom_admin_property_calendar_review',{p_property:propertyId,p_cursor:cursor});rows.push(...page.items);if(rows.length>50000)throw new BackendError('VALIDATION_ERROR');if(page.nextCursor&&cursor&&page.nextCursor<=cursor)throw new BackendError('CONFIGURATION_ERROR');cursor=page.nextCursor;}while(cursor);
 return rows;
}
export async function adminOwnerCalendar(from:string,to:string):Promise<OwnerCalendarBlock[]> {
 const properties=await allProperties(null);const blocks:OwnerCalendarBlock[]=[];
 for(const p of properties)for(const e of await review(p.id))if(e.startDate<=to&&e.endDate>=from)blocks.push({id:e.id,propertyId:p.id,propertyName:p.name,timezone:p.timezone,startDate:e.startDate,endDate:e.endDate,providers:[e.provider],kind:e.kind,removed:e.status==='removed',changes:e.reviewRequired?[{id:e.id,type:'conflict',message:'Calendar details need review.',acknowledged:false}]:[]});
 return blocks;
}
export async function adminOwnerPerformance(from:string,toExclusive:string,ids:string[]|null) {
 const properties=await allProperties(ids);const events:OwnerAnalyticsInput['events']=[];
 for(const p of properties)for(const e of await review(p.id))if(e.startDate<toExclusive&&(e.endDate>from||e.startDate>=from))events.push({id:e.id,propertyId:p.id,startDate:e.startDate,endDate:e.endDate,kind:e.kind,removed:e.status==='removed',confirmed:e.kind==='reservation'&&!e.reviewRequired,origin:'unknown'});
 if(events.length>50000)throw new BackendError('VALIDATION_ERROR');
 // The existing admin review API has no positive booking-origin evidence.
 // Do not attribute booking origin from calendar provider alone.
 return calculateOwnerPerformance({properties:properties.map(p=>({id:p.id,name:p.name,timezone:p.timezone,coverage:[]})),events},from,toExclusive);
}
export async function adminOwnerFreshness(cursor:string|null) {
 const actor=await requireAdmin();const properties=(await propertyPage(cursor,100));const rows=[];
 for(const p of properties){const feeds=(await sources(p.id,actor.id)).filter(s=>s.enabled);rows.push({propertyId:p.id,lastSuccessAt:feeds.length&&feeds.every(s=>s.lastSuccessAt)?feeds.map(s=>s.lastSuccessAt!).sort()[0]:null,message:feeds.some(s=>s.message)?'Calendar update needs attention.':feeds.length?null:'Calendar source not configured.'});}
 return rows;
}
