import {currentUser} from '@/server/auth/session';
import {privilegedDatabase} from '@/server/db/privileged';
import {response,mutation} from '@/server/db/http';
import {BackendError,databaseError} from '@/server/db/errors';
import {find} from 'geo-tz';
import {encodePlace,decodePlace,type Place} from '@/server/locations/cities';
type Address=Place&{street:string;latitude:number;longitude:number};
export async function GET(request:Request){return response(async()=>{
 const user=await currentUser();if(user.role!=='owner'&&user.role!=='admin')throw new BackendError('FORBIDDEN');
 const q=new URL(request.url).searchParams.get('q')?.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase()??'';
 if(q.length<4||q.length>200)throw new BackendError('VALIDATION_ERROR');
 const db=privilegedDatabase(),key='v1:us:en:address:'+q;
 const cached=await db.from('city_search_cache').select('places').eq('query_key',key).maybeSingle();if(cached.error)databaseError(cached.error);
 let places:Address[]=cached.data?.places;
 if(!places){
  const token=process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;if(!token)throw new BackendError('CONFIGURATION_ERROR');
  const url=new URL('https://api.mapbox.com/search/geocode/v6/forward');url.search=new URLSearchParams({q,country:'us',language:'en',types:'address',autocomplete:'true',permanent:'true',limit:'5',access_token:token}).toString();
  const result=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!result.ok)throw new BackendError('SOURCE_UNAVAILABLE');
  const data=await result.json();
  places=(data.features??[]).flatMap((f:{geometry?:{coordinates?:number[]};properties?:{full_address?:string;context?:{place?:{mapbox_id?:string;name?:string};region?:{name?:string};country?:{country_code?:string}}}})=>{
   const p=f.properties,c=p?.context,city=c?.place;const [longitude,latitude]=f.geometry?.coordinates??[];
   if(!p?.full_address||!city?.mapbox_id||!city.name||!c?.region?.name||c.country?.country_code?.toUpperCase()!=='US'||!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)return [];
   return [{id:city.mapbox_id,name:city.name,region:c.region.name,country:'US',label:[city.name,c.region.name,'United States'].join(', '),timezone:find(latitude,longitude)[0],street:p.full_address,latitude,longitude}];
  });
  const saved=await db.from('city_search_cache').upsert({query_key:key,places});if(saved.error)databaseError(saved.error);
 }
 return places.map(place=>({label:place.street,city:place.label,timezone:place.timezone,token:encodePlace(place)}));
});}
export async function POST(request:Request){return response(async()=>{
 const user=await currentUser();if(user.role!=='owner'&&user.role!=='admin')throw new BackendError('FORBIDDEN');
 const {body}=await mutation(request,['place']);const place=decodePlace(body.place) as Address;
 if(!place.street||!Number.isFinite(place.latitude)||!Number.isFinite(place.longitude))throw new BackendError('VALIDATION_ERROR');
 const {data,error}=await privilegedDatabase().rpc('bloom_city_register',{p_actor:user.id,p_place:place,p_timezone:place.timezone});if(error)databaseError(error);
 return {cityId:data.id,city:place.label,timezone:place.timezone,address:place.street,latitude:place.latitude,longitude:place.longitude};
});}
