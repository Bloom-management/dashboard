import 'server-only';
import {authenticatedDatabase,currentUser} from '../auth/session';
import {adminOwnerListings,adminOwnerPerformance} from './admin-view';
import type { OwnerAnalyticsInput, OwnerListingsPage } from '../../contracts/owner-hub';
import { userRpc } from '../db/rpc';
import { databaseError } from '../db/errors';
import { uuid } from '../db/http';
import { calculateOwnerPerformance } from '../calendar/owner-metrics';
import { loadOwnerAnalyticsRange } from './range';
import { performanceQuery } from './query';
export async function ownerListings(request: Request): Promise<OwnerListingsPage> {
 const cursor = new URL(request.url).searchParams.get('cursor');
 const page=(await currentUser()).role==='admin'?await adminOwnerListings(cursor?uuid(cursor):null):await userRpc<OwnerListingsPage>('bloom_owner_listings',{p_cursor:cursor ? uuid(cursor) : null});
 if(!page.items.length)return page;
 const {db}=await authenticatedDatabase();
 const {data,error}=await db.from('properties').select('id,city_id,cities(name)').in('id',page.items.map(p=>p.id));
 if(error)databaseError(error);
 return {...page,items:page.items.map(p=>{const row=data?.find(r=>r.id===p.id);const city=row?.cities as unknown as {name:string}|null;return {...p,cityId:row?.city_id??null,cityName:city?.name??null};})};
}
export async function ownerPerformance(request: Request) {
 const {from,toExclusive,properties} = performanceQuery(request);
 if((await currentUser()).role==='admin')return adminOwnerPerformance(from,toExclusive,properties);
 const input = await loadOwnerAnalyticsRange(from,toExclusive,async(start,end)=>userRpc<OwnerAnalyticsInput>('bloom_owner_analytics',{p_from:start,p_to_exclusive:end,p_properties:properties}));
 return calculateOwnerPerformance(input,from,toExclusive);
}
