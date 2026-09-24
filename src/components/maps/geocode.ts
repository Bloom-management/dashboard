import {validPin} from './points';
export type AddressPin={latitude:number;longitude:number;address:string;label:string};
export async function findAddress(address:string,token:string,signal?:AbortSignal):Promise<AddressPin[]>{
 const query=address.trim();
 if(!query||query.length>256||query.includes(';'))throw new Error('Enter a street address of at most 256 characters without semicolons.');
 if(!token.startsWith('pk.'))throw new Error('Address lookup is not configured. You can save the listing without a pin.');
 const url=new URL('https://api.mapbox.com/search/geocode/v6/forward');
 url.search=new URLSearchParams({q:query,access_token:token,permanent:'true',autocomplete:'false',types:'address',limit:'5'}).toString();
 const response=await fetch(url,{signal,cache:'no-store'});
 if(!response.ok)throw new Error(response.status===401||response.status===403?'Address lookup is unavailable. Ask your admin to check Mapbox token restrictions and permanent-geocoding billing.':'Address lookup failed. Try again, or save without a pin.');
 const data=await response.json();
 return (Array.isArray(data.features)?data.features:[]).flatMap((feature:{geometry?:{coordinates?:number[]};properties?:{full_address?:string}})=>{
  const coordinates=feature.geometry?.coordinates;const label=feature.properties?.full_address;
  const pin={longitude:coordinates?.[0],latitude:coordinates?.[1]};
  return typeof pin.latitude==='number'&&typeof pin.longitude==='number'&&validPin(pin as {latitude:number;longitude:number})&&typeof label==='string'?[{...pin,address,label} as AddressPin]:[];
 });
}
