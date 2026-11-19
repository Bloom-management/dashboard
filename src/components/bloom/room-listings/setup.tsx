'use client';
import {useCallback,useRef,useState} from 'react';
import {request} from '../api';
import {ErrorNotice,Loading,useResource} from '../primitives';
import {AccessInfo} from '../access-info';
import {OwnerSources} from '../owner-sources';
import type {OwnerSource} from '../../../contracts/owner-hub';
import styles from '../rental-model.module.css';

type Prices={firstHostCents:number;additionalHostCents:number;firstPoolCents:number;additionalPoolCents:number};
type Setup={sharedKinds:string[];pricing:Prices|null;hasAccess:boolean;canEdit:boolean};
const SHARED=[['kitchen','Kitchen'],['living_room','Living room'],['bathroom','Bathroom'],['house_laundry','Laundry'],['outdoor','Backyard']] as const;
const PRICES=[['firstHostCents','First room · host'],['additionalHostCents','Each extra room · host'],['firstPoolCents','First room · cleaner'],['additionalPoolCents','Each extra room · cleaner']] as const;
const dollars=(c:number|undefined)=>c==null?'':String(c/100);
const cents=(v:string)=>{const n=Number(v);return v.trim()===''||!Number.isFinite(n)?null:Math.round(n*100);};

/** Room draft setup: the house's shared spaces and cleaning prices, the room's access, and what is still missing. */
export function RoomDraftSetup({propertyId,hasInstructions}:{propertyId:string;hasInstructions:boolean}){
 const load=useCallback((signal:AbortSignal)=>request<Setup>(`/properties/${propertyId}/room-setup`,{signal}),[propertyId]);const data=useResource(load);
 if(data.loading&&!data.data)return <Loading/>;
 if(data.error)return <ErrorNotice error={data.error} retry={data.reload}/>;
 if(!data.data)return null;
 return <Editor key={JSON.stringify(data.data)} setup={data.data} propertyId={propertyId} hasInstructions={hasInstructions} reload={data.reload}/>;
}

function Editor({setup,propertyId,hasInstructions,reload}:{setup:Setup;propertyId:string;hasInstructions:boolean;reload:()=>void}){
 const [shared,setShared]=useState(()=>new Set(setup.sharedKinds));
 const [prices,setPrices]=useState<Record<keyof Prices,string>>(()=>Object.fromEntries(PRICES.map(([k])=>[k,dollars(setup.pricing?.[k])])) as Record<keyof Prices,string>);
 const [busy,setBusy]=useState(false);const [error,setError]=useState<unknown>();const keys=useRef(new Map<string,string>());
 const parsed=Object.fromEntries(PRICES.map(([k])=>[k,cents(prices[k])])) as Record<keyof Prices,number|null>;
 const pricesValid=parsed.firstHostCents!=null&&parsed.firstHostCents>0&&parsed.additionalHostCents!=null&&parsed.additionalHostCents>=0&&parsed.firstPoolCents!=null&&parsed.firstPoolCents>0&&parsed.firstPoolCents%2===0&&parsed.additionalPoolCents!=null&&parsed.additionalPoolCents>=0&&parsed.additionalPoolCents%2===0;
 const pricesChanged=PRICES.some(([k])=>parsed[k]!==(setup.pricing?.[k]??null));
 const sharedChanged=shared.size!==setup.sharedKinds.length||setup.sharedKinds.some(k=>!shared.has(k));
 async function save(action:'shared'|'pricing',data:unknown){
  if(busy)return;setBusy(true);setError(undefined);const body={action,data};const intent=JSON.stringify(body);
  if(!keys.current.has(intent))keys.current.set(intent,crypto.randomUUID());
  try{await request(`/properties/${propertyId}/room-setup`,{body,key:keys.current.get(intent)});reload();}catch(e){setError(e);}finally{setBusy(false);}
 }
 const checks:[string,boolean][]=[['Cleaning instructions',hasInstructions],['Shared spaces',setup.sharedKinds.length>0],['Cleaning prices',setup.pricing!=null],['Access info',setup.hasAccess]];
 return <>
  <h3>Ready to activate</h3>
  <ul className={styles.checklist}>{checks.map(([label,ok])=><li key={label} className={ok?styles.ok:styles.warn}>{label}</li>)}</ul>
  <h3>Shared spaces</h3>
  <div className={styles.chips} role="group" aria-label="Shared spaces">{SHARED.map(([k,l])=><button key={k} type="button" aria-pressed={shared.has(k)} disabled={busy||!setup.canEdit} onClick={()=>setShared(s=>{const n=new Set(s);if(n.has(k))n.delete(k);else n.add(k);return n;})}>{l}</button>)}</div>
  {setup.canEdit&&<button type="button" className="bloom-button secondary" disabled={busy||!sharedChanged||shared.size===0} onClick={()=>void save('shared',{kinds:SHARED.filter(([k])=>shared.has(k)).map(([k])=>k)})}>Save shared spaces</button>}
  <h3>Cleaning prices</h3>
  <div className={styles.priceGrid}>{PRICES.map(([k,label])=><label key={k}>{label}<input inputMode="decimal" disabled={busy||!setup.canEdit} value={prices[k]} onChange={e=>setPrices(p=>({...p,[k]:e.target.value}))}/></label>)}</div>
  {setup.canEdit&&<button type="button" className="bloom-button secondary" disabled={busy||!pricesValid||!pricesChanged} onClick={()=>void save('pricing',parsed)}>Save cleaning prices</button>}
  <h3>Access</h3>
  <AccessInfo propertyId={propertyId} onSaved={reload}/>
  {error!=null&&<ErrorNotice error={error}/>}
 </>;
}

type SourcePage={items:OwnerSource[];nextCursor:string|null};
const sourcesPath=(id:string)=>`/owner/properties/${encodeURIComponent(id)}/calendar-sources`;

/** A room draft's calendar links. Bookings sync now; cleanings start once the room is published. */
export function DraftCalendars({propertyId,name,timezone}:{propertyId:string;name:string;timezone:string}){
 const load=useCallback((signal:AbortSignal)=>request<SourcePage>(sourcesPath(propertyId),{signal}),[propertyId]);const data=useResource(load);
 if(data.loading&&!data.data)return <Loading/>;
 if(data.error)return <ErrorNotice error={data.error} retry={data.reload}/>;
 return <OwnerSources listing={{id:propertyId,name,timezone,sources:data.data?.items??[]}} onChanged={data.reload} showExport={false}/>;
}

/** After publishing, sync each calendar so its stored bookings get cleanings right away (the scheduler does it otherwise). */
export async function syncPublishedRoom(propertyId:string){
 try{const page=await request<SourcePage>(sourcesPath(propertyId));
  await Promise.allSettled(page.items.filter(s=>s.enabled).map(s=>request(`${sourcesPath(propertyId)}/${encodeURIComponent(s.id)}/sync`,{body:{},key:crypto.randomUUID()})));
 }catch{/* The scheduled sync attaches cleanings within minutes. */}
}
