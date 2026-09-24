'use client';
import {AddressPinPicker} from '../maps/address-pin';
import type {AddressPin} from '../maps/geocode';
import {OwnerPinSuggestion} from './owner-pin-suggestion';
import {calendarSaveMessage,type CalendarSaveResult} from '../../contracts/calendar-save';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { OwnerListing,OwnerListingCreateInput,OwnerListingCreateResult } from '../../contracts/owner-hub';
import type { CleaningConfig, Role } from '../../contracts';
import type { CityOption } from './integration';
import { ApiError, request } from './api';
import { ErrorNotice,Loading,Modal,useResource } from './primitives';
import { SupplySetupGrid } from './supply-setup-grid';
import { CalendarSetupSection, initialCalendars } from './calendar-setup-section';
import { OwnerSources } from './owner-listings';
import { ownerCreateInput,ownerCreationMayHaveSucceeded,type OwnerListingDraft } from './owner-create-input';

export function OwnerAddListingButton({role,onClick}:{role:Role;onClick:()=>void}) {
 if(role==='cleaner')return null;
 return role==='admin'?<Link className="bloom-button" href="/admin?view=properties&new=1">+ Add listing</Link>:<button className="bloom-button" type="button" onClick={onClick}>+ Add listing</button>;
}
const initial:OwnerListingDraft={name:'',address:'',cityId:'',timezone:'America/Detroit',bedroomCount:'0',bathroomCount:'0'};
/** Kept mounted when closed so uncertain creation retries retain the original receipt. */
export function OwnerCreateListing({open,listings,onClose,onCreated,onChanged,embedded=false,onBusyChange,onTitleChange}:{open:boolean;listings:OwnerListing[];onClose:()=>void;onCreated:(listing:OwnerListing)=>void;onChanged:()=>void;embedded?:boolean;onBusyChange?:(busy:boolean)=>void;onTitleChange?:(title:string)=>void}) {
 const [addressPin,setAddressPin]=useState<AddressPin|null>(null);const [createdAddress,setCreatedAddress]=useState('');
 const [setupStep,setSetupStep]=useState(0);
 const [draft,setDraft]=useState(initial);const [busy,setBusy]=useState(false);const [error,setError]=useState<unknown>();const [validation,setValidation]=useState('');
 const [created,setCreated]=useState<OwnerListing|null>(null);const [connect,setConnect]=useState(false);const [pending,setPending]=useState(false);
 const [calendars,setCalendars]=useState(initialCalendars);
 const [calendarResults,setCalendarResults]=useState<Record<string,string>>({});
 const calendarAttempts=useRef<{id:string;provider:'airbnb'|'vrbo';url:string;key:string;done:boolean}[]>([]);
 const calendarLock=useRef(false);
 async function saveCalendars(propertyId:string){
  if(calendarLock.current)return;calendarLock.current=true;setBusy(true);
  try{for(const feed of calendarAttempts.current){
   if(feed.done)continue;
   try{const saved=await request<CalendarSaveResult>(`/owner/properties/${propertyId}/calendar-sources`,{body:{provider:feed.provider,url:feed.url},key:feed.key});feed.done=true;setCalendarResults(current=>({...current,[feed.id]:calendarSaveMessage(saved.sync)}));}
   catch{setCalendarResults(current=>({...current,[feed.id]:'Not confirmed · Retry saving this calendar'}));}
  }onChanged();}finally{calendarLock.current=false;setBusy(false);}
 }
 const [supplies,setSupplies]=useState<{id:string;name:string}[]>([]);
 const [supplyError,setSupplyError]=useState<unknown>();const [suppliesSaved,setSuppliesSaved]=useState(false);
 const supplyAttempt=useRef<{propertyId:string;config:CleaningConfig;key:string}|null>(null);
 async function saveSupplies(){
  const attempt=supplyAttempt.current;if(!attempt)return;
  setBusy(true);setSupplyError(undefined);
  try{await request(`/owner/properties/${attempt.propertyId}/cleaning-config`,{body:attempt.config,key:attempt.key});supplyAttempt.current=null;setSuppliesSaved(true);onChanged();}
  catch(failure){setSupplyError(failure);}finally{setBusy(false);}
 }
 const receipt=useRef<{input:OwnerListingCreateInput;key:string}|null>(null);const locked=useRef(false);
 const loadCities=useCallback((signal:AbortSignal)=>open?request<CityOption[]>('/cities',{signal}):Promise.resolve([]),[open]);
 const cities=useResource(loadCities);
 const cityId=receipt.current?.input.cityId||draft.cityId||cities.data?.find(city=>city.active&&city.name.toLowerCase()==='detroit')?.id||'';
 function close(){if(busy||locked.current||calendarLock.current)return;onClose();if(created){setCreated(null);setConnect(false);setDraft(initial);setAddressPin(null);setSetupStep(0);setCalendars(initialCalendars());setCalendarResults({});calendarAttempts.current=[];setSupplies([]);setSuppliesSaved(false);setSupplyError(undefined);supplyAttempt.current=null;setError(undefined);setValidation('');}}
 async function save(event:React.FormEvent){
  event.preventDefault();if(locked.current)return;
  const input=receipt.current?.input??ownerCreateInput({...draft,cityId});
  if(!input){setValidation('Enter a name, address, active city, valid property timezone, and whole room counts from 0 to 20.');return;}
  if(!receipt.current)receipt.current={input,key:crypto.randomUUID()};
  locked.current=true;setBusy(true);setPending(true);setError(undefined);setValidation('');
  try{const result=await request<OwnerListingCreateResult>('/owner/listings',{body:receipt.current.input,key:receipt.current.key});const input=receipt.current.input;receipt.current=null;setPending(false);setCreated(result.listing);setCreatedAddress(input.address);onCreated(result.listing);
   if(supplies.some(s=>s.name.trim())){
    const rooms:CleaningConfig['rooms']=[];
    for(const [type,label,count] of [['bedrooms','Bedroom',input.bedroomCount],['bathrooms','Bathroom',input.bathroomCount],['kitchen','Kitchen',1],['living_room','Living room',1]] as const){
     for(let index=1;index<=count;index++)rooms.push({id:crypto.randomUUID(),type,label:`${label} ${index}`,requiredPhoto:true});
    }
    supplyAttempt.current={propertyId:result.listing.id,key:crypto.randomUUID(),config:{version:0,rooms,supplies:supplies.filter(s=>s.name.trim()).map(s=>({...s,name:s.name.trim()}))}};
    await saveSupplies();
   }
   calendarAttempts.current=calendars.filter(feed=>feed.url.trim()).map(feed=>({...feed,url:feed.url.trim(),key:crypto.randomUUID(),done:false}));
   await saveCalendars(result.listing.id);
  }
  catch(failure){setError(failure);if(failure instanceof ApiError&&!ownerCreationMayHaveSucceeded(failure.code)){receipt.current=null;setPending(false);}}
  finally{locked.current=false;setBusy(false);}
 }
 useEffect(()=>{onBusyChange?.(busy||locked.current||calendarLock.current);},[busy,onBusyChange]);
 useEffect(()=>{onTitleChange?.(created?'Listing saved':'Add a listing');},[created,onTitleChange]);
 if(!open)return null;
 const listing=created?(listings.find(item=>item.id===created.id)??created):null;
 const content=<div className="owner-create-body">{listing?<><h2>{listing.name} is saved</h2><OwnerPinSuggestion id={listing.id} address={createdAddress} initial={addressPin?.address.trim()===createdAddress?{...addressPin,address:createdAddress}:null}/><p>Your listing belongs to your owner account. You can manage its calendars now or later in Listings.</p>{calendarAttempts.current.length>0&&<section><h3>Calendars</h3><div className="owner-create-supply-grid">{calendarAttempts.current.map((feed,index)=><div className="owner-room-count-card" key={feed.id}><strong>{feed.provider==='airbnb'?'Airbnb':'Vrbo'} · Calendar {index+1}</strong><p role="status">{calendarResults[feed.id]??'Saving…'}</p></div>)}</div>{calendarAttempts.current.some(feed=>!feed.done)&&<button type="button" className="bloom-button secondary" disabled={busy} onClick={()=>void saveCalendars(listing.id)}>Retry saving calendars</button>}</section>}{suppliesSaved&&<p role="status">Supplies saved. You can update them later in Settings.</p>}{!!supplyError&&<div role="status"><p>Your listing is saved, but supplies have not been confirmed. Retry to save the same supplies.</p><ErrorNotice error={supplyError}/><button type="button" className="bloom-button secondary" disabled={busy} onClick={()=>void saveSupplies()}>Retry saving supplies</button></div>}{listing.setupRequired&&!suppliesSaved&&<p className="bloom-notice">Cleaning setup is required. Configure your rooms and supplies in Listings → Settings before cleaners can claim work.</p>}{connect?<><p>The listing is already saved. A calendar connection or sync error will not remove it.</p><OwnerSources listing={listing} onChanged={onChanged}/><button type="button" className="bloom-button secondary" onClick={close}>Done</button></>:<div className="bloom-actions"><button className="bloom-button" type="button" onClick={()=>setConnect(true)}>Manage calendars</button><button className="bloom-button secondary" type="button" onClick={close}>Do this later</button></div>}</>:<><h2>Add listing</h2><p>Add the unit to your owner account. Supplies and calendars are optional and can be added later.</p><form className="bloom-form" onSubmit={save} aria-busy={busy}><fieldset disabled={busy||pending} className="owner-create-fields"><label>Listing name<input required maxLength={200} value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></label><label>Address / unit<textarea required maxLength={500} value={draft.address} onChange={event=>setDraft({...draft,address:event.target.value})}/></label><AddressPinPicker key={draft.address} address={draft.address} value={addressPin} onChange={setAddressPin} owner/><label>City<select required value={cityId} onChange={event=>setDraft({...draft,cityId:event.target.value,timezone:cities.data?.find(city=>city.id===event.target.value)?.name.toLowerCase()==='detroit'?'America/Detroit':draft.timezone})}><option value="">Choose city</option>{cities.data?.filter(city=>city.active).map(city=><option key={city.id} value={city.id}>{city.name}</option>)}</select></label><label>Property timezone<input required maxLength={100} value={draft.timezone} onChange={event=>setDraft({...draft,timezone:event.target.value})}/><small>Use the property's IANA timezone, such as America/Detroit.</small></label><div className="owner-detail-navigation"><div className="view-toggle" role="group" aria-label="New listing setup">{['Rooms','Supplies'].map((label,index)=><button type="button" key={label} className={`vt-btn${setupStep===index?' active':''}`} aria-pressed={setupStep===index} onClick={()=>setSetupStep(index)}>{label}</button>)}</div><div className="bloom-actions"><button type="button" className="bloom-button secondary" aria-label="Previous setup step" disabled={setupStep===0} onClick={()=>setSetupStep(Math.max(0,setupStep-1))}>‹</button><button type="button" className="bloom-button secondary" aria-label="Next setup step" disabled={setupStep===1} onClick={()=>setSetupStep(Math.min(1,setupStep+1))}>›</button></div></div><fieldset hidden={setupStep!==0}><legend>Room counts</legend><div className="owner-room-counts">{(['bedroomCount','bathroomCount'] as const).map(field=>{
 const label=field==='bedroomCount'?'Bedrooms':'Bathrooms';const count=Number(draft[field]);
 return <div className="owner-room-count-card" key={field}>
 <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{field==='bathroomCount'?<path d="M3 12h18v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-3ZM5 12V5a2 2 0 0 1 4 0M6 19v2M18 19v2"/>:<path d="M3 18V6M21 18V6M3 15h18M3 10h18v5M6 10V7h5v3M13 10V7h5v3"/>}</svg>
 <h4>{label}</h4><div className="owner-room-stepper">
 <button type="button" aria-label={`Decrease ${label.toLowerCase()}`} disabled={count<=0} onClick={()=>setDraft(current=>({...current,[field]:String(Math.max(0,Number(current[field])-1))}))}>−</button>
 <output aria-label={`${label} count`}>{count}</output>
 <button type="button" aria-label={`Increase ${label.toLowerCase()}`} disabled={count>=20} onClick={()=>setDraft(current=>({...current,[field]:String(Math.min(20,Number(current[field])+1))}))}>+</button>
 </div></div>;
})}</div></fieldset><div hidden={setupStep!==1}><SupplySetupGrid supplies={supplies} onChange={setSupplies} optional/></div><CalendarSetupSection calendars={calendars} onChange={setCalendars}/></fieldset>{cities.loading?<Loading/>:cities.error?<ErrorNotice error={cities.error} retry={cities.reload}/>:!cities.data?.some(city=>city.active)&&<p className="bloom-notice">No supported cities are available. Contact your admin.</p>}{validation&&<p role="alert">{validation}</p>}{!!error&&<ErrorNotice error={error}/>} {pending&&!busy&&<p>Your original details and request are kept for a safe retry. Retry this same listing to check whether it was saved.</p>}<button className="bloom-button" disabled={busy||(!pending&&(cities.loading||!!cities.error||!cityId))}>{busy?'Saving…':pending?'Retry saving this listing':'Save listing'}</button>{embedded&&<button type="button" className="bloom-button secondary" disabled={busy} onClick={close}>Do this later</button>}</form></>}</div>;
 return embedded?content:<Modal title={listing?'Listing saved':'Add listing'} onClose={close} className="owner-create-dialog">{content}</Modal>;
}
