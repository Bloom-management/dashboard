import {requireAdmin} from '../../../../server/auth/session';
import {privilegedDatabase} from '../../../../server/db/privileged';
import {userRpc} from '../../../../server/db/rpc';
import {response,mutation,uuid,text} from '../../../../server/db/http';
import {databaseError} from '../../../../server/db/errors';
export async function GET(){return response(async()=>{
 await requireAdmin();const db=privilegedDatabase();
 const cities=await db.from('cities').select('id,name,active,cleaning_coverage,region,country_code,notification_timezone').order('name');if(cities.error)databaseError(cities.error);
 return Promise.all((cities.data??[]).map(async city=>{
  const [properties,cleaners]=await Promise.all([
   db.from('properties').select('id',{count:'exact',head:true}).eq('city_id',city.id),
   db.from('users').select('id',{count:'exact',head:true}).eq('role','cleaner').eq('approved_city_id',city.id),
  ]);
  if(properties.error)databaseError(properties.error);if(cleaners.error)databaseError(cleaners.error);
  return {...city,properties:properties.count??0,cleaners:cleaners.count??0};
 }));
});}

export async function POST(request:Request){return response(async()=>{const {body,key}=await mutation(request,['cityId','coverage']);return userRpc('bloom_city_coverage',{p_city:uuid(body.cityId),p_status:text(body.coverage,30),p_key:key});});}
