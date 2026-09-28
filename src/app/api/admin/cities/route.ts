import {requireAdmin} from '../../../../server/auth/session';
import {privilegedDatabase} from '../../../../server/db/privileged';
import {response} from '../../../../server/db/http';
import {databaseError} from '../../../../server/db/errors';
export async function GET(){return response(async()=>{
 await requireAdmin();const db=privilegedDatabase();
 const cities=await db.from('cities').select('id,name,active').order('name');if(cities.error)databaseError(cities.error);
 return Promise.all((cities.data??[]).map(async city=>{
  const [properties,cleaners]=await Promise.all([
   db.from('properties').select('id',{count:'exact',head:true}).eq('city_id',city.id),
   db.from('users').select('id',{count:'exact',head:true}).eq('role','cleaner').eq('approved_city_id',city.id),
  ]);
  if(properties.error)databaseError(properties.error);if(cleaners.error)databaseError(cleaners.error);
  return {...city,properties:properties.count??0,cleaners:cleaners.count??0};
 }));
});}
