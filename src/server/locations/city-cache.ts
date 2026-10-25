import 'server-only';
import {privilegedDatabase} from '../db/privileged';
import {databaseError} from '../db/errors';
import {searchCities,decodePlace,encodePlace,type Place} from './cities';

export interface CityCache {
 read(key:string):Promise<Place[]|null>;
 write(key:string,places:Place[]):Promise<void>;
}
const databaseCache:CityCache={
 async read(key){const {data,error}=await privilegedDatabase().from('city_search_cache').select('places').eq('query_key',key).maybeSingle();if(error)databaseError(error);return data?.places??null;},
 async write(key,places){const {error}=await privilegedDatabase().from('city_search_cache').upsert({query_key:key,places},{onConflict:'query_key'});if(error)databaseError(error);}
};
export function createCitySearch(cache:CityCache,search=searchCities){
 const pending=new Map<string,Promise<Place[]>>();
 return async(query:string)=>{
  const normalized=query.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
  const key='v1:us:en:place:'+normalized;
  let task=pending.get(key);
  if(!task){
   task=(async()=>{const existing=await cache.read(key);if(existing)return existing;
    const places=(await search(normalized)).map(result=>decodePlace(result.token));
    await cache.write(key,places);return places;
   })();pending.set(key,task);
  }
  try{return (await task).map(place=>({label:place.label,timezone:place.timezone,token:encodePlace(place)}));}
  finally{if(pending.get(key)===task)pending.delete(key);}
 };
}
export const cachedCitySearch=createCitySearch(databaseCache);
