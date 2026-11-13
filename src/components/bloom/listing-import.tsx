'use client';
import {useRef,useState} from 'react';
import type {ListingImport} from '../../server/properties/listing-import';
import type {CleaningConfig,PhotoCategory} from '../../contracts';
import {request,ApiError} from './api';
import {ErrorNotice} from './primitives';
import {AirbnbListingUrlField,announceCoverChange} from './property-thumbnail';
import type {PropertyCover} from '../../server/properties/airbnb-cover';
import styles from './listing-import.module.css';

/** An imported listing plus the suggestions the user kept. */
export type ImportedListing={data:ListingImport;supplies:string[];maintenance:string[]};

function Checklist({legend,items,selected,onChange,disabled}:{legend:string;items:string[];selected:string[];onChange:(next:string[])=>void;disabled?:boolean}){
 if(!items.length)return null;
 return <fieldset className={styles.checklist} disabled={disabled}><legend>{legend}</legend><div className={styles.chips}>{items.map(item=><label key={item} className={styles.chip}><input type="checkbox" checked={selected.includes(item)} onChange={e=>onChange(e.target.checked?[...selected,item]:selected.filter(v=>v!==item))}/><span>{item}</span></label>)}</div></fieldset>;
}

const bare=(line:string)=>line.trim().replace(/^[-•*]\s*/,'');
/** Ticking a suggestion appends it as a "- " line; unticking removes that line. Text typed by hand is left alone. */
export function InstructionSuggestions({suggestions,value,onChange,disabled}:{suggestions:string[];value:string;onChange:(next:string)=>void;disabled?:boolean}){
 if(!suggestions.length)return null;
 const present=new Set(value.split('\n').map(bare));
 function toggle(line:string,on:boolean){
  if(on){const text=value.trimEnd();onChange(`${text}${text?'\n':''}- ${line}`.slice(0,5000));}
  else onChange(value.split('\n').filter(l=>bare(l)!==line).join('\n'));
 }
 return <fieldset className={styles.checklist} disabled={disabled}><legend>Suggested cleaning instructions</legend><div className={styles.list}>{suggestions.map(line=><label key={line} className={styles.option}><input type="checkbox" checked={present.has(line)} onChange={e=>toggle(line,e.target.checked)}/><span>{line}</span></label>)}</div><small>Ticked lines are added to Cleaning instructions below. Edit them freely.</small></fieldset>;
}
/** Fills an empty instructions box with every suggestion; existing text is never overwritten. */
export const suggestedInstructions=(current:string,suggestions:string[])=>current.trim()?current:suggestions.map(l=>`- ${l}`).join('\n').slice(0,5000);

/** Loads suggestions for an already-saved listing link, such as a draft's. */
export function ListingInstructionSuggestions({listingUrl,value,onChange,disabled}:{listingUrl:string;value:string;onChange:(next:string)=>void;disabled?:boolean}){
 const [suggestions,setSuggestions]=useState<string[]|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState<unknown>();
 async function load(){if(busy)return;setBusy(true);setError(undefined);try{const data=await request<ListingImport>('/listing-prefill',{body:{listingUrl}});setSuggestions(data.instructions);if(!data.instructions.length)setError(new ApiError('SOURCE_UNAVAILABLE','Airbnb did not share listing details. Try again later.'));}catch(e){setError(e);}finally{setBusy(false);}}
 return <div className={styles.import}>{suggestions?.length?<InstructionSuggestions suggestions={suggestions} value={value} onChange={onChange} disabled={disabled}/>:<button type="button" className="bloom-button secondary" disabled={disabled||busy} onClick={()=>void load()}>{busy?'Reading listing…':'Suggest cleaning instructions from Airbnb'}</button>}{error!=null&&<ErrorNotice error={error}/>}</div>;
}

/** Top-of-dialog Airbnb import. Prefills the form via `onImported`; suggestions are applied after save with `applyListingImport`. */
export function ListingImportSection({value,onChange,onImported,listingType,disabled,instructions,onInstructionsChange}:{value:ImportedListing|null;onChange:(value:ImportedListing|null)=>void;onImported:(data:ListingImport)=>void;listingType:'entire_home'|'room';disabled?:boolean;instructions:string;onInstructionsChange:(next:string)=>void}){
 const [url,setUrl]=useState(value?.data.listingUrl??'');const [busy,setBusy]=useState(false);const [error,setError]=useState<unknown>();
 async function run(){
  if(busy||!url.trim())return;setBusy(true);setError(undefined);
  try{const data=await request<ListingImport>('/listing-prefill',{body:{listingUrl:url.trim()}});setUrl(data.listingUrl);onChange({data,supplies:data.supplies,maintenance:data.maintenance});onImported(data);onInstructionsChange(suggestedInstructions(instructions,data.instructions));}
  catch(e){setError(e);}finally{setBusy(false);}
 }
 const data=value?.data;const stale=!!data&&url.trim()!==data.listingUrl;
 const facts=data&&[data.bedrooms!=null&&(data.bedrooms===0?'Studio':`${data.bedrooms} bedroom${data.bedrooms===1?'':'s'}`),data.bathrooms!=null&&`${data.bathrooms} bathroom${data.bathrooms===1?'':'s'}`].filter(Boolean).join(' · ');
 return <section className={styles.import} aria-label="Import from Airbnb">
  <div className={styles.row} onKeyDown={e=>{if(e.key==='Enter'&&(e.target as HTMLElement).tagName==='INPUT'){e.preventDefault();void run();}}}>
   <AirbnbListingUrlField label="Import Airbnb listing (optional)" value={url} onChange={setUrl}/>
   <button type="button" className="bloom-button secondary" disabled={disabled||busy||!url.trim()||(!!data&&!stale)} onClick={()=>void run()}>{busy?'Importing…':'Import'}</button>
  </div>
  <small>Paste the public listing link. Bloom uses it for the cover photo and to suggest supplies{listingType==='room'?' and maintenance checks':''}.</small>
  {error!=null&&<ErrorNotice error={error instanceof ApiError&&error.code==='VALIDATION_ERROR'?new ApiError('VALIDATION_ERROR','Enter an Airbnb listing link, such as https://www.airbnb.com/rooms/123.'):error}/>}
  {data&&!stale&&<div className={styles.preview}>
   {data.image?<img src={data.image} alt="" referrerPolicy="no-referrer" onError={e=>{e.currentTarget.style.display='none';}}/>:null}
   <div className={styles.summary}><strong>{data.title??'Airbnb listing'}</strong>{facts&&<span>{facts}</span>}{data.status==='unavailable'&&<span>Airbnb did not share listing details. The link is still saved, and you can retry cover extraction in Settings.</span>}
    <button type="button" className={styles.clear} disabled={disabled} onClick={()=>{onChange(null);setUrl('');}}>Remove import</button></div>
  </div>}
  {data&&!stale&&value&&<>
   <Checklist legend="Suggested supplies" items={data.supplies} selected={value.supplies} disabled={disabled} onChange={supplies=>onChange({...value,supplies})}/>
   {listingType==='room'?<Checklist legend="Suggested maintenance checks" items={data.maintenance} selected={value.maintenance} disabled={disabled} onChange={maintenance=>onChange({...value,maintenance})}/>:data.supplies.length>0&&<small>Entire homes use Bloom’s standard maintenance checklist. Rooms from the listing ({facts||'kitchen and living room'}) are added to the cleaning setup with these supplies.</small>}
   <InstructionSuggestions suggestions={data.instructions} value={instructions} onChange={onInstructionsChange} disabled={disabled}/>
  </>}
 </section>;
}

const roomName:Record<PhotoCategory,string>={bedrooms:'Bedroom',bathrooms:'Bathroom',kitchen:'Kitchen',living_room:'Living room'};
function rooms(bedrooms:number,bathrooms:number):CleaningConfig['rooms']{
 const make=(type:PhotoCategory,count:number)=>Array.from({length:count},(_,i)=>({id:crypto.randomUUID(),type,label:`${roomName[type]} ${i+1}`,requiredPhoto:true as const}));
 return [...make('bedrooms',bedrooms),...make('bathrooms',bathrooms),...make('kitchen',1),...make('living_room',1)];
}
/** Stable idempotency keys per property+step so a retried save never duplicates work. */
export function useImportReceipts(){const keys=useRef(new Map<string,string>());return (step:string)=>{let key=keys.current.get(step);if(!key){key=crypto.randomUUID();keys.current.set(step,key);}return key;};}

/** Saves the listing link (Settings → Airbnb listing and cover photo) and seeds the kept suggestions. Returns a problem message, or null. */
export async function applyListingImport(propertyId:string,imported:ImportedListing,listingType:'entire_home'|'room',receipt:(step:string)=>string):Promise<string|null>{
 const problems:string[]=[];
 try{
  const cover=await request<PropertyCover>(`/properties/${propertyId}/airbnb`);
  if(cover.listingUrl!==imported.data.listingUrl){await request(`/properties/${propertyId}/airbnb`,{body:{listingUrl:imported.data.listingUrl,manualImageUrl:null,revision:cover.revision},key:receipt(`${propertyId}:airbnb`)});announceCoverChange(propertyId);}
 }catch{problems.push('the Airbnb link (add it in Settings)');}
 if(listingType==='room'){
  const items=[...imported.supplies.map(name=>['add_shared_supply',name]),...imported.maintenance.map(name=>['add_shared_maintenance',name])];
  let failed=false;
  for(const [action,value] of items){
   // CONFLICT means the house already has this item, which is the outcome we want.
   try{await request('/house-items',{body:{propertyId,action,value},key:receipt(`${propertyId}:${action}:${value}`)});}catch(e){if(!(e instanceof ApiError&&e.code==='CONFLICT'))failed=true;}
  }
  if(failed)problems.push('some supplies or maintenance checks');
 }else if(imported.supplies.length){
  try{
   const path=`/owner/properties/${propertyId}/cleaning-config`;const current=await request<CleaningConfig|null>(path);
   if(!current?.version){const config={version:current?.version??0,rooms:rooms(imported.data.bedrooms??0,imported.data.bathrooms??0),supplies:imported.supplies.slice(0,100).map(name=>({id:crypto.randomUUID(),name:name.slice(0,100)}))};await request(path,{body:config,key:receipt(`${propertyId}:cleaning-config`)});}
  }catch{problems.push('the supply list (add supplies in Settings)');}
 }
 return problems.length?`Property saved, but Bloom could not import ${problems.join(' and ')}.`:null;
}
