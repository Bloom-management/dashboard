'use client';
import {SelectorPill} from './selector-pill';
import {CarouselArrows} from './carousel-arrows';
import {AddressSearch} from './address-search';
import {InviteCleanerForm} from './invite-cleaner-form';
import type {AddressPin} from '../maps/geocode';
import {OwnerPinSuggestion} from './owner-pin-suggestion';
import {calendarSaveMessage,type CalendarSaveResult} from '../../contracts/calendar-save';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { OwnerListing,OwnerListingCreateInput,OwnerListingCreateResult } from '../../contracts/owner-hub';
import type { CleaningConfig, Role } from '../../contracts';
import { ApiError, request } from './api';
import { ErrorNotice,Modal, Icon} from './primitives';
import { SupplySetupGrid, MaintenanceSetupGrid } from './supply-setup-grid';
import { CalendarSetupSection, initialCalendars } from './calendar-setup-section';
import { OwnerSources } from './owner-listings';
import {ListingImportSection,applyListingImport,useImportReceipts,type ImportedListing} from './listing-import';
import {BackButton} from './back-button';
import {AccessEntryFields,AccessParkingFields,accessFromAmenities,emptyAccess} from './access-info';
import {ButtonContent} from './button-content';
import { ownerCreateInput,ownerCreationMayHaveSucceeded,type OwnerListingDraft } from './owner-create-input';

export function OwnerAddListingButton({role,onClick}:{role:Role;onClick:()=>void}) {
 if(role==='cleaner')return null;
 return role==='admin'?<Link className="bloom-button" href="/admin?view=properties&new=1">+ Add listing</Link>:<button className="bloom-button" type="button" onClick={onClick}>+ Add listing</button>;
}
const initial:OwnerListingDraft={name:'',address:'',cityId:'',timezone:'America/Detroit',bedroomCount:'0',bathroomCount:'0'};
/** Kept mounted when closed so uncertain creation retries retain the original receipt. */
export function OwnerCreateListing({open,listings,onClose,onCreated,onChanged,embedded=false,onBusyChange,onTitleChange,cleanerEmail:initialCleanerEmail='',initialPage=0}:{initialPage?:0|1;open:boolean;listings:OwnerListing[];onClose:()=>void;onCreated:(listing:OwnerListing)=>void;onChanged:()=>void;embedded?:boolean;onBusyChange?:(busy:boolean)=>void;onTitleChange?:(title:string)=>void;cleanerEmail?:string}) {
 const [cleanerEmail,setCleanerEmail]=useState(initialCleanerEmail);
 const [addressPin,setAddressPin]=useState<AddressPin|null>(null);const [createdAddress,setCreatedAddress]=useState('');
 const [unit,setUnit]=useState('');
 const [setupStep,setSetupStep]=useState(0);
 // Page 1: optional Airbnb import + address. Page 2: the rest of the listing.
 const [page,setPage]=useState<0|1>(initialPage);
 const [imported,setImported]=useState<ImportedListing|null>(null);const [importMessage,setImportMessage]=useState('');const importReceipt=useImportReceipts();
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
 const [maintenance,setMaintenance]=useState<{id:string;name:string}[]>([]);
 const [access,setAccess]=useState(emptyAccess);
 const [supplyError,setSupplyError]=useState<unknown>();const [suppliesSaved,setSuppliesSaved]=useState(false);
 const supplyAttempt=useRef<{propertyId:string;config:CleaningConfig;key:string}|null>(null);
 async function saveSupplies(){
  const attempt=supplyAttempt.current;if(!attempt)return;
  setBusy(true);setSupplyError(undefined);
  try{await request(`/owner/properties/${attempt.propertyId}/cleaning-config`,{body:attempt.config,key:attempt.key});supplyAttempt.current=null;setSuppliesSaved(true);onChanged();}
  catch(failure){setSupplyError(failure);}finally{setBusy(false);}
 }
 /** Adds the listing's own maintenance checks. A retried save reuses each check's key, and CONFLICT means it already exists. */
 async function saveMaintenance(propertyId:string):Promise<string|null>{
  const names=[...new Set(maintenance.map(m=>m.name.trim()).filter(Boolean))];let failed=false;
  for(const value of names){try{await request('/house-items',{body:{propertyId,action:'add_room_maintenance',value},key:importReceipt(`${propertyId}:maintenance:${value}`)});}catch(e){if(!(e instanceof ApiError&&e.code==='CONFLICT'))failed=true;}}
  return failed?'Listing saved, but some maintenance checks could not be added. Add them in the Maintenance tab.':null;
 }
 /** Saves entry and parking details when any were given. The property is new, so this creates version 1. */
 async function saveAccess(propertyId:string):Promise<string|null>{
  const {version:_version,...given}=access;const {version:_empty,...empty}=emptyAccess;
  if(JSON.stringify(given)===JSON.stringify(empty))return null;
  try{await request(`/properties/${propertyId}/access-info`,{body:{...access,version:0},key:importReceipt(`${propertyId}:access`)});return null;}
  catch(e){return e instanceof ApiError&&e.code==='CONFLICT'?null:'Listing saved, but access info could not be saved. Add it in the listing’s Settings.';}
 }
 const receipt=useRef<{input:OwnerListingCreateInput;key:string}|null>(null);const locked=useRef(false);
 const cityId=receipt.current?.input.cityId||draft.cityId||'';
 function close(){if(busy||locked.current||calendarLock.current)return;onClose();if(created){setCreated(null);setConnect(false);setCleanerEmail('');setDraft(initial);setUnit('');setAddressPin(null);setSetupStep(0);setPage(0);setImported(null);setImportMessage('');setCalendars(initialCalendars());setCalendarResults({});calendarAttempts.current=[];setSupplies([]);setMaintenance([]);setAccess(emptyAccess);setSuppliesSaved(false);setSupplyError(undefined);supplyAttempt.current=null;setError(undefined);setValidation('');}}
 // Save draft keeps an unfinished listing on the Drafts page (Listings → Drafts) instead of creating it.
 const draftKey=useRef<{input:string;key:string}|null>(null);
 async function saveDraft(){
  if(busy)return;
  if(!cityId){setValidation('Choose the address before saving a draft.');return;}
  const body={action:'create',cityId,listingType:'entire_home',houseId:null,data:{name:draft.name.trim(),address:unit.trim()?draft.address+' · Unit '+unit.trim():draft.address,timezone:draft.timezone||'America/Detroit'}};
  const input=JSON.stringify(body);if(draftKey.current?.input!==input)draftKey.current={input,key:crypto.randomUUID()};
  setBusy(true);setError(undefined);setValidation('');
  try{
   await request('/listing-drafts',{body,key:draftKey.current.key});
   onChanged();onClose();
   const url=new URL(window.location.href);url.searchParams.set('listings','drafts');window.history.pushState(null,'',url);window.dispatchEvent(new PopStateEvent('popstate'));
  }catch(e){setError(e);}finally{setBusy(false);}
 }
 function next(){if(!draft.address.trim()||!draft.cityId){setValidation('Choose the street address from the suggestions.');return;}setValidation('');setPage(1);}
 async function save(event:React.FormEvent){
  event.preventDefault();if(locked.current)return;
  if(page===0){next();return;}
  const input=receipt.current?.input??ownerCreateInput({...draft,address:unit.trim()?draft.address+' · Unit '+unit.trim():draft.address,cityId});
  if(!input){setValidation('Enter a name, address, city, valid property timezone, and whole room counts from 0 to 20.');return;}
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
   const problems=[await saveMaintenance(result.listing.id),await saveAccess(result.listing.id),imported?await applyListingImport(result.listing.id,{...imported,supplies:[],maintenance:[]},'entire_home',importReceipt):null].filter(Boolean);
   setImportMessage(problems.join(' '));
  }
  catch(failure){setError(failure);if(failure instanceof ApiError&&!ownerCreationMayHaveSucceeded(failure.code)){receipt.current=null;setPending(false);}}
  finally{locked.current=false;setBusy(false);}
 }
 useEffect(()=>{onBusyChange?.(busy||locked.current||calendarLock.current);},[busy,onBusyChange]);
 useEffect(()=>{onTitleChange?.(created?'Listing saved':'Add a listing');},[created,onTitleChange]);
 if(!open)return null;
 const listing=created?(listings.find(item=>item.id===created.id)??created):null;
 const content=<div className="owner-create-body">{listing?<><h2>{listing.name} is saved</h2><InviteCleanerForm propertyId={listing.id} email={cleanerEmail}/><OwnerPinSuggestion id={listing.id} address={createdAddress} initial={addressPin?{...addressPin,address:createdAddress}:null}/>{calendarAttempts.current.length>0&&<section><h3>Calendars</h3><div className="owner-create-supply-grid">{calendarAttempts.current.map((feed,index)=><div className="owner-room-count-card" key={feed.id}><strong>{feed.provider==='airbnb'?'Airbnb':'Vrbo'} · Calendar {index+1}</strong><p role="status">{calendarResults[feed.id]??'Saving…'}</p></div>)}</div>{calendarAttempts.current.some(feed=>!feed.done)&&<button type="button" className="bloom-button secondary" disabled={busy} onClick={()=>void saveCalendars(listing.id)}>Retry saving calendars</button>}</section>}{importMessage&&<p className="bloom-notice" role="alert">{importMessage}</p>}{!!supplyError&&<div role="status"><p>Your listing is saved, but supplies have not been confirmed. Retry to save the same supplies.</p><ErrorNotice error={supplyError}/><button type="button" className="bloom-button secondary" disabled={busy} onClick={()=>void saveSupplies()}>Retry saving supplies</button></div>}{listing.setupRequired&&!suppliesSaved&&<p className="bloom-notice">Cleaning setup is required. Configure your rooms and supplies in Listings → Settings before cleaners can claim work.</p>}{connect?<><p>The listing is already saved. A calendar connection or sync error will not remove it.</p><OwnerSources listing={listing} onChanged={onChanged}/><button type="button" className="bloom-button secondary" onClick={close}>Done</button></>:<div className="bloom-actions"><button className="bloom-button" type="button" onClick={()=>setConnect(true)}>Manage calendars</button><button className="bloom-button secondary" type="button" onClick={close}>Do this later</button></div>}</>:<><h2>Add listing</h2><p className="owner-create-step">Step {page+1} of 2 · {page===0?'Import and address':'Listing details'}</p><form className="bloom-form" onSubmit={save} aria-busy={busy}><div hidden={page!==0}><fieldset disabled={busy||pending} className="owner-create-fields"><ListingImportSection value={imported} onChange={setImported} showSuggestions={false} disabled={busy||pending} onImported={data=>{setDraft(current=>({...current,name:current.name.trim()?current.name:(data.title??'').slice(0,200),bedroomCount:data.bedrooms!=null?String(Math.min(20,Math.max(0,data.bedrooms))):current.bedroomCount,bathroomCount:data.bathrooms!=null?String(Math.min(20,Math.max(0,Math.ceil(data.bathrooms)))):current.bathroomCount}));if(data.supplies.length)setSupplies(current=>current.some(s=>s.name.trim())?current:data.supplies.slice(0,100).map(name=>({id:crypto.randomUUID(),name:name.slice(0,100)})));setAccess(current=>accessFromAmenities(data.amenities,current));if(data.maintenance.length)setMaintenance(current=>current.some(m=>m.name.trim())?current:data.maintenance.slice(0,100).map(name=>({id:crypto.randomUUID(),name:name.slice(0,100)})));}}/><AddressSearch value={draft.address} disabled={busy||pending} onChange={address=>setDraft(previous=>({...previous,address}))} onSelect={address=>{setDraft(previous=>({...previous,cityId:address?.cityId??'',timezone:address?.timezone??''}));setAddressPin(address?{address:address.address,label:address.address,latitude:address.latitude,longitude:address.longitude}:null);}}/><label>Apartment / unit (optional)<input maxLength={100} autoComplete="address-line2" value={unit} onChange={event=>setUnit(event.target.value)}/></label></fieldset>{validation&&<p role="alert">{validation}</p>}<div className="bloom-actions"><button className="bloom-button" type="submit"><ButtonContent icon={<Icon name="arrow-right"/>}>Next</ButtonContent></button>{embedded&&<button type="button" className="bloom-button secondary" disabled={busy} onClick={close}>Do this later</button>}</div></div>{page===1&&<><BackButton disabled={busy||pending} onClick={()=>{setValidation('');setPage(0);}}>Back to import and address</BackButton><fieldset disabled={busy||pending} className="owner-create-fields"><label>Listing name<input required maxLength={200} value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></label><div className="owner-detail-navigation"><SelectorPill role="group" aria-label="New listing setup">{['Rooms','Supplies','Maintenance','Access'].map((label,index)=><button type="button" key={label} className={`vt-btn${setupStep===index?' active':''}`} aria-pressed={setupStep===index} onClick={()=>setSetupStep(index)}>{label}</button>)}</SelectorPill><CarouselArrows label="setup step" previousDisabled={setupStep===0} nextDisabled={setupStep===3} onPrevious={()=>setSetupStep(Math.max(0,setupStep-1))} onNext={()=>setSetupStep(Math.min(3,setupStep+1))}/></div><fieldset hidden={setupStep!==0}><legend>Room counts</legend><div className="owner-room-counts">{(['bedroomCount','bathroomCount'] as const).map(field=>{
 const label=field==='bedroomCount'?'Bedrooms':'Bathrooms';const count=Number(draft[field]);
 return <div className="owner-room-count-card" key={field}>
 <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{field==='bathroomCount'?<path d="M3 12h18v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-3ZM5 12V5a2 2 0 0 1 4 0M6 19v2M18 19v2"/>:<path d="M3 18V6M21 18V6M3 15h18M3 10h18v5M6 10V7h5v3M13 10V7h5v3"/>}</svg>
 <h4>{label}</h4><div className="owner-room-stepper">
 <button type="button" aria-label={`Decrease ${label.toLowerCase()}`} disabled={count<=0} onClick={()=>setDraft(current=>({...current,[field]:String(Math.max(0,Number(current[field])-1))}))}><Icon name="minus" size={18}/></button>
 <output aria-label={`${label} count`}>{count}</output>
 <button type="button" aria-label={`Increase ${label.toLowerCase()}`} disabled={count>=20} onClick={()=>setDraft(current=>({...current,[field]:String(Math.min(20,Number(current[field])+1))}))}><Icon name="plus" size={18}/></button>
 </div></div>;
})}</div></fieldset><div hidden={setupStep!==1}><SupplySetupGrid supplies={supplies} onChange={setSupplies} optional/></div><div hidden={setupStep!==2}><MaintenanceSetupGrid items={maintenance} onChange={setMaintenance}/></div><div hidden={setupStep!==3}><fieldset><legend>Entry (optional)</legend><AccessEntryFields value={access} onChange={setAccess}/></fieldset><fieldset><legend>Parking (optional)</legend><AccessParkingFields value={access} onChange={setAccess}/></fieldset></div><label>Would you like to invite a cleaner?<input type="email" maxLength={254} placeholder="Cleaner email (optional)" value={cleanerEmail} onChange={event=>setCleanerEmail(event.target.value)}/><small>Optional. After your listing is saved, confirm and send the property invitation.</small></label><CalendarSetupSection calendars={calendars} onChange={setCalendars}/></fieldset>{validation&&<p role="alert">{validation}</p>}{!!error&&<ErrorNotice error={error}/>} {pending&&!busy&&<p>Your original details and request are kept for a safe retry. Retry this same listing to check whether it was saved.</p>}<button className="bloom-button" disabled={busy||(!pending&&(!cityId))}>{busy?'Saving…':pending?'Retry saving this listing':'Save listing'}</button>{!pending&&<button type="button" className="bloom-button secondary" disabled={busy||!cityId} onClick={()=>void saveDraft()}>Save draft</button>}{embedded&&<button type="button" className="bloom-button secondary" disabled={busy} onClick={close}>Do this later</button>}</>}</form></>}</div>;
 return embedded?content:<Modal title={listing?'Listing saved':'Add listing'} onClose={close} className="owner-create-dialog">{content}</Modal>;
}
