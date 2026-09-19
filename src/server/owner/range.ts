import type { OwnerAnalyticsInput } from '../../contracts/owner-hub';
import { BackendError } from '../db/errors';
/** Existing SQL accepts at most 366 nights. Reauthorize each slice and calculate once over deduplicated events. */
export async function loadOwnerAnalyticsRange(from:string,to:string,load:(from:string,to:string)=>Promise<OwnerAnalyticsInput>):Promise<OwnerAnalyticsInput> {
 const properties=new Map<string,OwnerAnalyticsInput['properties'][number]>();
 const events=new Map<string,OwnerAnalyticsInput['events'][number]>();
 let expected:string|undefined;
 for(let start=Date.parse(from);start<Date.parse(to);){
  const end=Math.min(Date.parse(to),start+366*86400000);
  const page=await load(new Date(start).toISOString().slice(0,10),new Date(end).toISOString().slice(0,10));
  const ids=JSON.stringify(page.properties.map(p=>p.id).sort());
  if(expected!==undefined&&expected!==ids)throw new BackendError('CONFLICT');expected=ids;
  for(const p of page.properties){const previous=properties.get(p.id);properties.set(p.id,{...p,coverage:[...(previous?.coverage??[]),...p.coverage]});}
  for(const event of page.events){const previous=events.get(event.id);if(previous&&JSON.stringify(previous)!==JSON.stringify(event))throw new BackendError('CONFLICT');events.set(event.id,event);}
  if(events.size>50000)throw new BackendError('VALIDATION_ERROR');
  start=end;
 }
 return {properties:[...properties.values()],events:[...events.values()]};
}
