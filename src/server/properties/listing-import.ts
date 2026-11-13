import {parseProduct} from '../supplies/product-preview';
import {coverUrl} from './airbnb-cover';

/** Public Airbnb listing details used to prefill a new property. Every field is a suggestion the user reviews. */
export type ListingImport={
 listingUrl:string;image:string|null;status:'extracted'|'unavailable';
 title:string|null;kind:'room'|'entire_home'|null;bedrooms:number|null;bathrooms:number|null;
 amenities:string[];supplies:string[];maintenance:string[];instructions:string[];
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
const baseInstructions=[
 'Strip every bed and remake it with fresh linens.',
 'Clean and disinfect the bathroom: toilet, shower or tub, sink and mirror.',
 'Wipe kitchen counters, sink and appliance fronts.',
 'Vacuum and mop all floors.',
 'Empty all trash and replace the liners.',
 'Restock supplies and report anything running low.',
];
const instructionRules:[RegExp,string][]=[
 [/dishwasher/i,'Run the dishwasher if it has dirty dishes, and put away clean ones.'],
 [/(?<!dish)washer/i,'Start laundry first so linens and towels are dry before you leave.'],
 [/refrigerator/i,'Remove guest food from the fridge and wipe the shelves.'],
 [/microwave/i,'Wipe the inside of the microwave.'],
 [/stove|oven/i,'Check the stovetop and oven for spills.'],
 [/coffee maker|espresso|keurig|nespresso/i,'Empty and rinse the coffee maker.'],
 [/pets allowed/i,'Pets are allowed: vacuum for pet hair on furniture and under beds.'],
 [/hot tub/i,'Check the hot tub water and cover, and wipe the edges.'],
 [/fireplace/i,'Make sure the fireplace is off and clear of debris.'],
 [/patio|balcony|outdoor furniture|outdoor dining/i,'Sweep the patio and reset the outdoor furniture.'],
 [/bbq|grill/i,'Clean the grill grates.'],
 [/ev charger/i,'Make sure the EV charger cable is stowed.'],
 [/extra pillows/i,'Check that extra pillows and blankets are clean and stored.'],
 [/crib|pack ’n play|pack 'n play/i,'Check that the travel crib is clean and folded.'],
 [/keypad|smart lock|self check-in|lockbox/i,'Lock the door when you leave and confirm the keypad works.'],
];
/** Cleaning instructions suggested from the listing type, shared spaces and amenities. */
export function listingInstructions(amenities:string[],kind:ListingImport['kind'],sharedBath=false){
 const lines=kind==='room'?['Clean only this room and its assigned spaces; leave other guests’ rooms untouched.',...baseInstructions.map(l=>l.startsWith('Vacuum')?'Vacuum and mop the room floor.':l),...(sharedBath?['Clean the shared bathroom after the room is done.']:[])]:[...baseInstructions];
 for(const [rule,line] of instructionRules)if(amenities.some(a=>rule.test(a.replace(/hair dryer/i,''))))lines.push(line);
 return [...new Set(lines)];
}
export function parseListing(html:string,listingUrl:string):ListingImport{
 // og:title is "Townhouse in Detroit · ★4.98 · 2 bedrooms · 3 beds · 2.5 baths"; og:description holds the listing title.
 const summary=meta(html,'og:title')??'';
 const title=(meta(html,'og:description')??decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]??'').split(' - ')[0]).trim().slice(0,200)||null;
 const count=(pattern:RegExp)=>{const value=summary.match(pattern)?.[1];return value==null?null:Number(value);};
 const bedrooms=/\bstudio\b/i.test(summary)?0:count(/(\d+)\s+bedrooms?\b/i);
 const baths=count(/(\d+(?:\.\d+)?)\s+(?:private |shared |dedicated )?(?:half-)?baths?\b/i);
 // og:title says "Home in …" even for private rooms; the embedded roomType is authoritative.
 const roomType=html.match(/"roomType":"([^"]{1,40})"/)?.[1]??'';
 const kind=/private room|shared room|hotel room/i.test(roomType)||/^\s*(?:private |shared )?room\b/i.test(summary)?'room':roomType||summary?'entire_home':null;
 let image:string|null=null;try{const raw=parseProduct(html,listingUrl).imageUrl;image=raw?coverUrl(raw):null;}catch{}
 const amenities=listingAmenities(html);
 return {listingUrl,image,status:image?'extracted':'unavailable',title,kind,bedrooms:bedrooms==null?null:Math.min(bedrooms,20),bathrooms:baths==null?null:Math.min(Math.ceil(baths),20),amenities,...listingSuggestions(amenities),instructions:listingInstructions(amenities,kind,/\bshared (?:half-)?baths?\b/i.test(summary))};
}
