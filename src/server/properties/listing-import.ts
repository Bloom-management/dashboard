import {parseProduct} from '../supplies/product-preview';
import {coverUrl} from './airbnb-cover';

/** Public Airbnb listing details used to prefill a new property. Every field is a suggestion the user reviews. */
export type ListingImport={
 listingUrl:string;image:string|null;status:'extracted'|'unavailable';
 title:string|null;kind:'room'|'entire_home'|null;bedrooms:number|null;bathrooms:number|null;
 amenities:string[];supplies:string[];maintenance:string[];
};

const decode=(value:string)=>value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
function meta(html:string,key:string){
 for(const tag of html.matchAll(/<meta\b[^>]*>/gi)){
  if(new RegExp(`(?:property|name)\\s*=\\s*["']${key}["']`,'i').test(tag[0]))return decode(tag[0].match(/content\s*=\s*(?:"([^"]*)"|'([^']*)')/i)?.slice(1).find(v=>v!=null)??'').trim()||null;
 }
 return null;
}
/** Airbnb SSR embeds each amenity as an `AmenityItem` JSON object. */
export function listingAmenities(html:string){
 const found=new Set<string>();
 // Read only the flat prefix: items may carry a nested `subtitle` object after the title.
 for(const match of html.matchAll(/\{"__typename":"AmenityItem"[^{}]*/g)){
  if(!/"available":true\b/.test(match[0]))continue;
  const raw=match[0].match(/"title":("(?:[^"\\]|\\.){1,240}")/)?.[1];
  try{const title=raw?(JSON.parse(raw) as string).trim():'';if(title)found.add(title.slice(0,120));}catch{}
 }
 return [...found].slice(0,200);
}
const baseSupplies=['Toilet paper','Paper towels','Trash bags','Hand soap','Dish soap'];
const supplyRules:[RegExp,string[]][]=[
 [/^shampoo/i,['Shampoo']],[/^conditioner/i,['Conditioner']],[/body soap|shower gel|body wash/i,['Body wash']],
 [/^coffee$/i,['Coffee']],[/coffee maker|espresso|keurig|nespresso/i,['Coffee','Coffee filters']],[/kettle/i,['Tea']],
 [/dishwasher/i,['Dishwasher pods']],[/(?<!dish)washer/i,["Laundry detergent"]],[/dryer/i,['Dryer sheets']],
 [/cleaning products/i,['All-purpose cleaner']],[/cooking basics/i,['Cooking oil','Salt and pepper']],
 [/first aid/i,['First aid kit']],[/bed linens/i,['Spare bed linens']],
];
const maintenanceRules:[RegExp,string][]=[
 [/smoke alarm/i,'Smoke alarm'],[/carbon monoxide/i,'Carbon monoxide alarm'],[/fire extinguisher/i,'Fire extinguisher'],
 [/^wifi|wi-fi/i,'Wi-Fi'],[/\btv\b|hdtv/i,'TV'],[/air conditioning|\bac\b/i,'Air conditioning'],[/^heating/i,'Heating'],
 [/^hot water$/i,'Water heater'],[/(?<!dish)washer/i,'Washer'],[/dryer/i,'Dryer'],[/dishwasher/i,'Dishwasher'],
 [/refrigerator/i,'Refrigerator'],[/stove|oven/i,'Stove and oven'],[/microwave/i,'Microwave'],[/keypad|smart lock/i,'Door keypad'],
 [/ev charger/i,'EV charger'],[/hot tub/i,'Hot tub'],[/\bpool\b/i,'Pool'],[/garage/i,'Garage door'],[/fireplace/i,'Fireplace'],
];
/** Supplies and maintenance checks suggested from the listing's available amenities. */
export function listingSuggestions(amenities:string[]){
 const supplies=new Set(baseSupplies),maintenance=new Set<string>();
 for(const amenity of amenities){
  // "Hair dryer" is a guest amenity, not a laundry appliance.
  const appliance=amenity.replace(/hair dryer/i,'');
  for(const [rule,names] of supplyRules)if(rule.test(appliance))names.forEach(n=>supplies.add(n));
  for(const [rule,name] of maintenanceRules)if(rule.test(appliance))maintenance.add(name);
 }
 return {supplies:[...supplies],maintenance:[...maintenance]};
}
export function parseListing(html:string,listingUrl:string):ListingImport{
 // og:title is "Townhouse in Detroit · ★4.98 · 2 bedrooms · 3 beds · 2.5 baths"; og:description holds the listing title.
 const summary=meta(html,'og:title')??'';
 const title=(meta(html,'og:description')??decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]??'').split(' - ')[0]).trim().slice(0,200)||null;
 const count=(pattern:RegExp)=>{const value=summary.match(pattern)?.[1];return value==null?null:Number(value);};
 const bedrooms=/\bstudio\b/i.test(summary)?0:count(/(\d+)\s+bedrooms?\b/i);
 const baths=count(/(\d+(?:\.\d+)?)\s+(?:private |shared |dedicated )?(?:half-)?baths?\b/i);
 const kind=/^\s*(?:private |shared )?room\b/i.test(summary)?'room':summary?'entire_home':null;
 let image:string|null=null;try{const raw=parseProduct(html,listingUrl).imageUrl;image=raw?coverUrl(raw):null;}catch{}
 const amenities=listingAmenities(html);
 return {listingUrl,image,status:image?'extracted':'unavailable',title,kind,bedrooms:bedrooms==null?null:Math.min(bedrooms,20),bathrooms:baths==null?null:Math.min(Math.ceil(baths),20),amenities,...listingSuggestions(amenities)};
}
