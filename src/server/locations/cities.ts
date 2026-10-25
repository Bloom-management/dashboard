import 'server-only';
import {find} from 'geo-tz';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {BackendError} from '../db/errors';
export type Place={id:string;name:string;region:string;country:string;label:string;timezone:string};
function sign(value:string){const secret=process.env.CALENDAR_ENCRYPTION_KEY;if(!secret)throw new BackendError('CONFIGURATION_ERROR');return createHmac('sha256',secret).update('city:'+value).digest('hex');}
export function encodePlace(place:Place){const value=Buffer.from(JSON.stringify({place,expires:Date.now()+15*60000})).toString('base64url');return value+'.'+sign(value);}
export function decodePlace(token:unknown):Place{
 if(typeof token!=='string'||token.length>4096)throw new BackendError('VALIDATION_ERROR');
 const [value,mac]=token.split('.');const expected=sign(value);if(!mac||mac.length!==expected.length||!timingSafeEqual(Buffer.from(mac),Buffer.from(expected)))throw new BackendError('VALIDATION_ERROR');
 try{const data=JSON.parse(Buffer.from(value,'base64url').toString());if(data.expires<Date.now()||!data.place?.id||typeof data.place.timezone!=='string')throw new Error();return data.place;}catch{throw new BackendError('VALIDATION_ERROR');}
}
export async function searchCities(query:string):Promise<{label:string;timezone:string;token:string}[]>{
 const token=process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;if(!token)throw new BackendError('CONFIGURATION_ERROR');
 const url=new URL('https://api.mapbox.com/search/geocode/v6/forward');url.search=new URLSearchParams({q:query,types:'place',autocomplete:'true',permanent:'true',limit:'5',country:'us',language:'en',access_token:token}).toString();
 const response=await fetch(url,{signal:AbortSignal.timeout(8000),cache:'no-store'});if(!response.ok)throw new BackendError('SOURCE_UNAVAILABLE');
 const data=await response.json();
 return (data.features??[]).flatMap((feature:{geometry?:{coordinates?:number[]};properties?:{mapbox_id?:string;name?:string;place_formatted?:string;context?:{region?:{name?:string};country?:{country_code?:string;name?:string}}}})=>{
  const p=feature.properties;const region=p?.context?.region?.name,country=p?.context?.country?.country_code?.toUpperCase();if(!p?.mapbox_id||!p.name||!region||country!=='US')return [];
  const [longitude,latitude]=feature.geometry?.coordinates??[];
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)return [];
  const timezone=find(latitude,longitude)[0];if(!timezone)return [];
  const place={timezone,id:p.mapbox_id,name:p.name,region,country,label:[p.name,region,p.context?.country?.name??country].join(', ')};
  return [{label:place.label,timezone,token:encodePlace(place)}];
 });
}
