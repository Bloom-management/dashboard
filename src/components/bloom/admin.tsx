'use client';
import {RoomSpaces} from './room-listings/spaces';
import {RoomVisitDialog} from './room-listings/visit';
import {CalendarSourceBrand} from './booking-source-card';
import {BookingSourceCard} from './booking-source-card';
import {PropertyThumbnailSettings} from './property-thumbnail';
import {ListingImportSection,applyListingImport,useImportReceipts,type ImportedListing} from './listing-import';
import {AccessInfo} from './access-info';
import {CalendarTypeToggle} from './calendar-add-flow';
import type {OwnerCalendarBlock} from '../../contracts';
import {CalendarExport} from './calendar-export';
import {CleaningActivity} from './activity';
import {CleanerAvatar} from './cleaner-identity';
import {Select} from '../ui/select';
import {MobileViewMenu} from './mobile-view-menu';
import {SelectorPill} from './selector-pill';
import {AddressPinPicker} from '../maps/address-pin';
import type {AddressPin} from '../maps/geocode';
import {PropertyPin} from './property-pin';

import {navigationLabel} from './navigation-labels';
import {calendarSaveMessage,type CalendarSaveResult} from '../../contracts/calendar-save';

import '../../styles/bloom-owner.css';
import { CalendarSetupSection, initialCalendars } from './calendar-setup-section';
import { AdminPayouts } from './admin-payouts';
import {ServiceCities} from './service-cities';
import { AdminPricingInbox, AdminUnitPricing, AdminPricingEditor } from './admin-pricing';
import { CleanerDayDialog } from './cleaner-day-dialog';
import { OwnerListings } from './owner-listings';
import type { OwnerListing, OwnerListingsPage } from '../../contracts/owner-hub';
import { PropertyPeoplePanel } from './property-people';
import { PendingInvitations } from './pending-invitations';
import { InvitePerson } from './invite-person';
import { DatePicker } from './date-picker';
import { CleaningConfiguration, CompletionReport } from './cleaning-config';
import { LocationDropdown } from './location-dropdown';
import { BookingCalendar } from '../ui/calendar';
import {CalendarFilters,CleanerPhoneMonth,PhoneMonthSection,PhoneMonths,useIsPhone} from './cleaner-mobile-calendar';
import {DropdownMenu,DropdownMenuContent,DropdownMenuRadioGroup,DropdownMenuRadioItem,DropdownMenuTrigger} from '../ui/dropdown-menu';
import {Paginated,Result,useMutation} from './admin-shared';
import {JobStaffing} from './job-staffing';
import styles from './admin-jobs.module.css';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCalendar } from './use-calendar';
import { parseSoloRate, propertyOwnership } from './property-form';
import type { CleanerJob, Role, SessionUser } from '../../contracts';
import { request } from './api';
import { formatDate, formatTime, monthRange, money, shiftMonth, todayIn } from './dates';
import type { AdminPerson, BloomIntegration, CityRequest, PropertyOption, SourceHealth } from './integration';
import { Account, Brand, HubSelector, Changes, Empty, ErrorNotice, Icon, Loading, Modal, MonthHead, RoleGate, useResource } from './primitives';
import { Photos } from './photos';
import { CalendarReviewList } from './calendar-review';
import { OwnerMonth } from './owner-month';
import {BackButton} from './back-button';
import {ButtonContent} from './button-content';

const noIntegration: BloomIntegration = {};
const unavailable = <Empty title="This admin tool is not available yet">The management service must be connected before you can use this tool.</Empty>;
function UserRow({ user, currentUser, reload }: { user: AdminPerson; currentUser: SessionUser; reload: () => void }) {
  const mutation = useMutation();
  return <tr><th scope="row">{user.displayName}</th><td>{user.email??'Not available'}</td><td>
    <Select aria-label={`Role for ${user.displayName}`} value={user.role} disabled={user.id===currentUser.id||mutation.busy} onChange={async event=>{
      const role=event.target.value as Role;
      if(await mutation.run({role},key=>request(`/admin/users/${encodeURIComponent(user.id)}/role`,{body:{role},key})))reload();
    }}><option value="cleaner">Cleaner</option><option value="owner">Owner</option><option value="admin">Admin</option></Select>
    {mutation.busy&&<small role="status">Saving…</small>}
    {user.id===currentUser.id&&<small>Your account</small>}
    {!!mutation.error&&<ErrorNotice error={mutation.error}/>}
  </td><td>{user.location??'—'}</td></tr>;
}

function RequestRow({ item, reload, integration }: { item: CityRequest; reload: () => void; integration: BloomIntegration }) {
  const mutation = useMutation();
  async function decide(decision: 'approved' | 'rejected') {
    if (await mutation.run({ decision }, key => integration.admin!.resolveCityRequest(item.id, decision, key, item.type))) reload();
  }
  return <article className="bloom-admin-card"><h3>{item.cleanerName}</h3><p>{item.type==='bloom_pool'?'Join Bloom':'City change'}</p><p>Requested city: {item.requestedCityName} · {item.status==='rejected'?'Declined':item.status}</p>{item.status === 'pending' && <div className="bloom-actions"><button className="bloom-button" disabled={mutation.busy} onClick={() => decide('approved')}>Approve</button><button className="bloom-button secondary" disabled={mutation.busy} onClick={() => decide('rejected')}>Decline</button></div>}<Result mutation={mutation} /></article>;
}
function PropertyForm({ integration, created, houses=[], draftSaved }: { integration: BloomIntegration; created: (id:string) => void; houses?:{id:string;name:string}[]; draftSaved?:()=>void }) {
  // Listing type, house and room identifier come from the draft form: room listings are saved as drafts and set up from Drafts.
  const [listingType,setListingType]=useState<'entire_home'|'room'>('entire_home');
  const [house,setHouse]=useState('');const [identifier,setIdentifier]=useState('');
  const draftMutation=useMutation();
  const [draft, setDraft] = useState<Omit<PropertyOption, 'id'>>({ name:'',cityId:'',timezone:'America/Detroit',address:'',instructions:'',isBloomOwned:true,active:true,ownerIds:[],soloRateCents:7500 });
  const [addressPin,setAddressPin]=useState<AddressPin|null>(null);const [pinConfirmed,setPinConfirmed]=useState(false);
  const [rate,setRate]=useState('75.00');
  const [calendars,setCalendars]=useState(initialCalendars);
  const [savedProperty,setSavedProperty]=useState<string|null>(null);
  const savedId=useRef<string|null>(null);
  const [calendarMessages,setCalendarMessages]=useState<string[]>([]);
  const calendarFailed=useRef(false);
  const calendarReceipts=useRef(new Map<string,{key:string;done:boolean}>());
  const [ownerMode,setOwnerMode]=useState<'existing'|'pending'>('existing');
  const [ownerEmail,setOwnerEmail]=useState('');
  const [validation,setValidation]=useState('');
  // Step 1: optional Airbnb import + address. Step 2: everything else.
  const [step,setStep]=useState<0|1>(0);
  function next(){if(!draft.address.trim()){setValidation('Enter the property address.');return;}setValidation('');setStep(1);}
  const [imported,setImported]=useState<ImportedListing|null>(null);const [importMessage,setImportMessage]=useState('');const importReceipt=useImportReceipts();const importDone=useRef<string|null>(null);
  async function applyImport(id:string,type:'entire_home'|'room'){
    if(!imported||importDone.current===id)return true;
    const problem=await applyListingImport(id,imported,type,importReceipt);setImportMessage(problem??'');
    if(!problem)importDone.current=id;return !problem;
  }
  const rateCents = parseSoloRate(rate);
  const mutation=useMutation();
  const citiesLoad=useCallback((signal:AbortSignal)=>integration.listCities!(signal),[integration]);
  const cities=useResource(citiesLoad);
  async function saveDraft(){
    const cityId=draft.cityId||cities.data?.find(c=>c.active&&c.name.toLowerCase()==='detroit')?.id||'';
    if(!cityId){setValidation('Choose a city before saving a draft.');return;}
    if(listingType==='room'&&!identifier.trim()){setValidation('Enter the room identifier, such as DH1.');return;}
    setValidation('');
    const body={action:'create',cityId,listingType,houseId:listingType==='room'&&house?house:null,data:{name:draft.name.trim(),...(listingType==='room'&&house?{}:{address:draft.address}),timezone:draft.timezone,...(listingType==='room'?{identifier:identifier.trim()}:{}),...(draft.instructions.trim()?{instructions:draft.instructions}:{})}};
    let draftId='';
    if(await draftMutation.run(body,async key=>{draftId=(await request<{id:string}>('/listing-drafts',{body,key})).id;})){
      draftSaved?.();
      if(!await applyImport(draftId,'room'))return;
      const url=new URL(window.location.href);url.searchParams.delete('new');url.searchParams.set('listings','drafts');window.history.pushState(null,'',url);window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }
  async function save(event:FormEvent){
    event.preventDefault();
    if(step===0){next();return;}
    if(listingType==='room'){await saveDraft();return;}
    const soloRateCents = parseSoloRate(rate);
    if (soloRateCents === null) { setValidation('Enter a positive USD rate in two-cent increments so it can be split evenly.'); return; }
    const ownership=propertyOwnership(draft.isBloomOwned,ownerMode,draft.ownerIds,ownerEmail);
    if (!ownership) { setValidation("Select an owner account or enter the pending owner’s email."); return; }
    try { new Intl.DateTimeFormat('en-US', { timeZone: draft.timezone }).format(); } catch { setValidation('Enter a valid property timezone, such as America/Detroit.'); return; }
    setValidation('');
    const input={...draft,...ownership,cityId:draft.cityId||cities.data?.find(c=>c.active&&c.name.toLowerCase()==='detroit')?.id||'',soloRateCents};
    await mutation.run(input,async key=>{if(!savedId.current){const result=await integration.admin!.createProperty(input,key);savedId.current=result.id;setSavedProperty(result.id);}
      if(addressPin?.address===draft.address&&pinConfirmed)await request(`/admin/properties/${savedId.current}/pin`,{body:{latitude:addressPin.latitude,longitude:addressPin.longitude,confirmed:true}});
      for(const feed of calendars.filter(feed=>feed.url.trim())){
        const identity=JSON.stringify([feed.provider,feed.url.trim()]);
        let receipt=calendarReceipts.current.get(identity);
        if(!receipt){receipt={key:crypto.randomUUID(),done:false};calendarReceipts.current.set(identity,receipt);}
        if(receipt.done)continue;
        const saved=await request<CalendarSaveResult>(`/admin/properties/${encodeURIComponent(savedId.current)}/calendar-sources`,{body:{provider:feed.provider,url:feed.url.trim()},key:receipt.key});receipt.done=true;setCalendarMessages(items=>[...items,calendarSaveMessage(saved.sync)]);if(saved.sync.status==='failed'||saved.sync.status==='partial')calendarFailed.current=true;
      }
      const importOk=await applyImport(savedId.current,'entire_home');
      if(!calendarFailed.current&&importOk)created(savedId.current);});
  }
  return <form className="bloom-form admin-create-property" onSubmit={save} aria-busy={mutation.busy}><h2>Add Property</h2><p className="property-create-step">Step {step+1} of 2 · {step===0?'Import and address':'Listing details'}</p>{step===0?<><fieldset className="property-create-fields" disabled={mutation.busy||draftMutation.busy||!!savedProperty}>
    <ListingImportSection value={imported} onChange={setImported} instructions={draft.instructions} onInstructionsChange={instructions=>setDraft(current=>({...current,instructions}))} disabled={mutation.busy||draftMutation.busy||!!savedProperty} onImported={data=>{if(data.kind&&data.kind!==listingType){setListingType(data.kind);setHouse('');}if(data.title&&!draft.name.trim())setDraft(current=>({...current,name:data.title!}));}}/>
    <label>Address<textarea required maxLength={500} value={draft.address} onChange={e=>{setDraft({...draft,address:e.target.value});setAddressPin(null);setPinConfirmed(false);}}/></label><AddressPinPicker key={draft.address} address={draft.address} value={addressPin} onChange={pin=>{setAddressPin(pin);setPinConfirmed(false);}}/>{addressPin?.address===draft.address&&<label><input type="checkbox" checked={pinConfirmed} onChange={e=>setPinConfirmed(e.target.checked)}/>I confirm this pin marks the property. Save it with this property.</label>}
    </fieldset>{validation&&<p className="bloom-notice" role="alert">{validation}</p>}<div className="bloom-actions"><button type="submit" className="bloom-button"><ButtonContent icon={<Icon name="arrow-right"/>}>Next</ButtonContent></button></div></>:<><BackButton disabled={mutation.busy||draftMutation.busy||!!savedProperty} onClick={()=>{setValidation('');setStep(0);}}>Back to import and address</BackButton><fieldset className="property-create-fields" disabled={mutation.busy||draftMutation.busy||!!savedProperty}>
    {listingType==='room'&&house&&<p>This room uses its house’s address.</p>}
    <label>Listing type<Select value={listingType} onChange={e=>{setListingType(e.target.value as 'entire_home'|'room');setHouse('');}}><option value="entire_home">Entire home</option><option value="room">Room</option></Select></label>
    {listingType==='room'&&<><label>House<Select value={house} onChange={e=>setHouse(e.target.value)}><option value="">New house</option>{houses.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}</Select></label>
    <label>Room identifier<input required maxLength={100} value={identifier} onChange={e=>setIdentifier(e.target.value)}/></label></>}
    <label>{listingType==='room'?'Listing title':'Name'}<input required maxLength={200} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
    {listingType==='entire_home'&&<><label>Ownership<Select value={draft.isBloomOwned?'bloom':'owner'} onChange={e=>setDraft({...draft,isBloomOwned:e.target.value==='bloom',ownerIds:[],pendingOwnerEmail:null})}><option value="bloom">Bloom-owned</option><option value="owner">Owner-owned</option></Select></label>
    {draft.isBloomOwned?<p>Bloom owns this property. No owner account is required.</p>:<fieldset><legend>Property owner</legend>
      <label>Owner setup<Select value={ownerMode} onChange={event=>setOwnerMode(event.target.value as 'existing'|'pending')}><option value="existing">Select an existing owner</option><option value="pending">Owner signs up later</option></Select></label>
      {ownerMode==='existing'?<><Paginated loader={integration.admin!.users} render={users=><>{users.filter(u=>u.role==='owner').map(owner=><label className="bloom-check" key={owner.id}><input type="checkbox" checked={draft.ownerIds.includes(owner.id)} onChange={e=>setDraft({...draft,ownerIds:e.target.checked?[...draft.ownerIds,owner.id]:draft.ownerIds.filter(id=>id!==owner.id)})}/>{owner.displayName}</label>)}{!users.some(u=>u.role==='owner')&&<p>No owner accounts on this page. Check other pages, or choose Owner signs up later to associate the property with the email they will verify.</p>}</>}/><p>Select at least one owner. Your admin account is not assigned as the owner.</p></>:<><label>Owner email<input type="email" required maxLength={254} autoComplete="off" value={ownerEmail} onChange={event=>setOwnerEmail(event.target.value)}/></label><p>The property stays pending until the owner signs in with this verified primary email. Share Bloom's sign-in address with them yourself; no invitation is sent. An existing cleaner or admin account may need admin help before it can become an owner.</p></>}
    </fieldset>}</>}
    <label>City<Select required value={draft.cityId||cities.data?.find(c=>c.active&&c.name.toLowerCase()==='detroit')?.id||''} onChange={e=>setDraft({...draft,cityId:e.target.value})}><option value="">Choose city</option>{cities.data?.filter(c=>c.active).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select></label>
    {cities.loading&&<Loading/>}{!!cities.error&&<ErrorNotice error={cities.error} retry={cities.reload}/>}
    <label>Property timezone<input required maxLength={100} value={draft.timezone} onChange={e=>setDraft({...draft,timezone:e.target.value})}/><small>Use an IANA timezone, such as America/Detroit.</small></label>
        <label>Cleaning instructions<textarea required={listingType==='entire_home'} maxLength={5000} value={draft.instructions} onChange={e=>setDraft({...draft,instructions:e.target.value})}/></label>
    {listingType==='entire_home'&&<><p>Cleaning window: 11 AM–3 PM on checkout day, in the property's timezone.</p>
    <label>Initial solo rate (USD)<input type="number" required min="0.02" step="0.02" value={rate} onChange={e=>setRate(e.target.value)}/><small>Shared rate: {rateCents === null ? 'Enter a valid solo rate' : money(rateCents/2)} per cleaner. Admins can update cleaner pricing in unit Settings.</small></label></>}
    </fieldset>{listingType==='entire_home'&&<CalendarSetupSection calendars={calendars} onChange={setCalendars} disabled={mutation.busy}/>}{savedProperty&&<p role="status">Your property is saved. Review calendar results below; saving again will not create another property.</p>}
    {calendarMessages.map((message,index)=><p role="status" key={index}>{message}</p>)}{importMessage&&<p className="bloom-notice" role="alert">{importMessage}</p>}{savedProperty&&<button type="button" className="bloom-button secondary" onClick={()=>created(savedProperty)}>Open saved property</button>}{validation && <p className="bloom-notice" role="alert">{validation}</p>}{listingType==='room'?<button className="bloom-button" disabled={draftMutation.busy||cities.loading||!!cities.error}>{draftMutation.busy?'Saving…':'Save draft'}</button>:<div className="bloom-actions"><button className="bloom-button" disabled={mutation.busy||draftMutation.busy||cities.loading||!!cities.error||!cities.data?.some(c=>c.active)||!propertyOwnership(draft.isBloomOwned,ownerMode,draft.ownerIds,ownerEmail)}>{mutation.busy?'Saving…':savedProperty?'Retry calendar links':'Save property'}</button>{!savedProperty&&<button type="button" className="bloom-button secondary" disabled={mutation.busy||draftMutation.busy} onClick={()=>void saveDraft()}>{draftMutation.busy?'Saving…':'Save draft'}</button>}</div>}<Result mutation={mutation}/><Result mutation={draftMutation}/></>}
  </form>;
}
function SourceRow({source,reload,onOutcome}:{source:SourceHealth;reload:()=>void;onOutcome:(message:string)=>void}) {
 const mutation=useMutation();
 async function sync(){
  onOutcome('');
  const saved=await mutation.run({sync:source.id},async key=>{
   const result=await request<import('../../contracts').SyncResult & {status?:'success'|'partial'|'not_modified'}>(`/admin/properties/${encodeURIComponent(source.propertyId)}/calendar-sources/${encodeURIComponent(source.id)}/sync`,{body:{},key});
   const status=result.status==='partial'?'Incomplete calendar; existing stays and jobs were preserved':result.status==='not_modified'?'Calendar unchanged':'Sync finished';
   onOutcome(`${source.provider==='airbnb'?'Airbnb':'Vrbo'}: ${status}. Calendar entries: ${result.created} created, ${result.updated} updated, ${result.removed} removed, ${result.unchanged} unchanged; ${result.conflicts} conflicts. These are calendar counts, not cleaning-job counts.`);
  });
  if(saved)reload();
 }
 return <article className="bloom-admin-card"><h3><CalendarSourceBrand provider={source.provider}/></h3><p>{source.enabled?'Enabled':'Disabled'} · Last successful sync: {source.lastSuccessAt?new Date(source.lastSuccessAt).toISOString():'Never'}</p><p>Last attempt: {source.lastAttemptAt?new Date(source.lastAttemptAt).toISOString():'Never'}</p>{source.errorMessage&&<p className="bloom-notice" role="alert">{source.errorMessage}</p>}<button className="bloom-button" disabled={mutation.busy||!source.enabled} onClick={sync}>{mutation.busy?'Syncing…':'Sync now'}</button><button type="button" className="bloom-button secondary" disabled={mutation.busy} onClick={reload}>Refresh sync status</button><Result mutation={mutation}/></article>;
}
function SourceForm({propertyId,reload}:{propertyId:string;reload:()=>void}) {
 const [provider,setProvider]=useState('airbnb');const [url,setUrl]=useState('');const mutation=useMutation();const [syncMessage,setSyncMessage]=useState('');
 return <form className="bloom-admin-card bloom-form" onSubmit={async e=>{e.preventDefault();if(await mutation.run({propertyId,provider,url},async key=>{const saved=await request<CalendarSaveResult>(`/admin/properties/${encodeURIComponent(propertyId)}/calendar-sources`,{body:{provider,url},key});setSyncMessage(calendarSaveMessage(saved.sync));})){setUrl('');reload();}}}><h3>Add calendar source</h3><p>The property is already saved. If saving or syncing this calendar fails, the property remains available and you can retry here.</p><p>{provider==='airbnb'?'Paste the Airbnb calendar export link for this property. Use the calendar export (iCal) link, not the listing page or an import link.':'Paste the Vrbo calendar export (iCal) link for this property.'} Links are private.</p><p>Saving a link automatically starts an import. Review its result below. If it fails, the link remains saved and you can choose Sync now to retry.</p><label>Platform<Select value={provider} onChange={e=>setProvider(e.target.value)}><option value="airbnb">Airbnb</option><option value="vrbo">Vrbo</option></Select></label><label>Private calendar export link<input type="password" autoComplete="off" required maxLength={4096} value={url} onChange={e=>setUrl(e.target.value)}/></label><button className="bloom-button" disabled={mutation.busy}>{mutation.busy?'Saving and syncing…':'Save calendar link'}</button><p role="status">{syncMessage}</p><Result mutation={mutation}/></form>;
}
function PropertySettings({id,integration,back,section='settings',room=false}:{room?:boolean;id:string;integration:BloomIntegration;back:()=>void;onRenamed:()=>void;section?:'settings'|'calendars'}) {
 const load=useCallback((signal:AbortSignal)=>integration.admin!.property(id,signal),[integration,id]);const property=useResource(load);
 const [revision,setRevision]=useState(0);const reload=()=>setRevision(v=>v+1);
 const [syncOutcome,setSyncOutcome]=useState('');
 const [reviewRevision,setReviewRevision]=useState(0);
 const reviews=useCallback((cursor:string|null,signal:AbortSignal)=>request<import('../../contracts').CalendarReviewPage>(`/admin/properties/${encodeURIComponent(id)}/calendar-review${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,{signal}),[id]);
 const sources=useCallback((cursor:string|null,signal:AbortSignal)=>integration.admin!.propertySources(id,cursor,signal),[integration,id]);
 if(property.loading)return <><BackButton onClick={back}>Back to Properties</BackButton><Loading/></>;if(property.error)return <><BackButton onClick={back}>Back to Properties</BackButton><ErrorNotice error={property.error} retry={property.reload}/></>;
 const p=property.data!;
 return <>{section==='settings'?<>{p.pendingOwnerEmail&&<p className="bloom-notice">Pending owner: {p.pendingOwnerEmail}. Access begins after sign-in with this verified primary email. No invitation has been sent.</p>}<PropertyThumbnailSettings key={id} id={id}/><PropertyPin id={id} address={p.address}/>{!room&&<AdminUnitPricing id={id} onSaved={property.reload}/>}<h3>Access info</h3><AccessInfo propertyId={id}/>{room?<RoomSpaces propertyId={id}/>:<CleaningConfiguration propertyId={id}/>}<PropertyPeoplePanel listing={p}/></>:<><h2>Connected calendars</h2><p>Airbnb and Vrbo sources for {p.name}. Links are kept private.</p><Paginated key={revision} loader={sources} render={(items,refresh)=><>{items.length?items.map(s=><SourceRow source={s} reload={()=>{refresh();setReviewRevision(value=>value+1);}} onOutcome={setSyncOutcome} key={s.id}/>):<Empty title="No calendar sources">Add an export link for this property below.</Empty>}</>}/><p role="status">{syncOutcome}</p><SourceForm propertyId={id} reload={reload}/><CalendarExport key={id} propertyId={id}/><section aria-label="Flagged calendar entries"><h2>Needs attention</h2><p>Read-only inspection of blocked, unconfirmed, or source-flagged stays. Dates are local to this property. Classification changes are not available here; use Jobs to resolve changes affecting existing cleanings.</p><Paginated key={reviewRevision} loader={reviews} render={items=><CalendarReviewList entries={items}/>}/></section></>}</>;
}
function Properties({integration,initialPropertyId}:{integration:BloomIntegration;initialPropertyId?:string}) {
 const router=useRouter();const search=useSearchParams();const adding=search.get('new')==='1';
 const [revision,setRevision]=useState(0);
 const load=useCallback(async(signal:AbortSignal)=>{
  const items:OwnerListing[]=[];let cursor:string|null=null;const seen=new Set<string>();
  do{
   const page:OwnerListingsPage=await request<OwnerListingsPage>(`/owner/listings${cursor?'?cursor='+encodeURIComponent(cursor):''}`,{signal});
   items.push(...page.items);cursor=page.nextCursor;
   if(cursor&&seen.has(cursor))throw new Error('Property pagination did not advance');
   if(cursor)seen.add(cursor);
  }while(cursor);
  return items;
 // Reload all authorized pages after mutations.
 },[]);
 const data=useResource(load,true);const changed=()=>{setRevision(value=>value+1);data.reload();};
 const back=()=>router.push('/admin?view=properties',{scroll:false});
 const range=monthRange(todayIn('UTC').slice(0,7));
 return <div className="bloom-owner admin-properties-workspace">
  {data.loading?<Loading/>:data.error?<ErrorNotice error={data.error} retry={data.reload}/>:<OwnerListings admin listings={data.data??[]} initialSelectedId={initialPropertyId} integration={integration} onChanged={changed} from={range.from} toExclusive={range.to} revision={revision}
   addListingAction={<div className="bloom-actions"><button className="bloom-button secondary" onClick={changed}>Refresh</button><Link className="bloom-button" href="/admin?view=properties&new=1" scroll={false}>+ Add listing</Link></div>}
   renderCalendars={listing=><PropertySettings section="calendars" key={listing.id} id={listing.id} integration={integration} back={back} onRenamed={changed}/>}
   renderSettings={listing=><PropertySettings room={listing.listingType==='room'} key={listing.id} id={listing.id} integration={integration} back={back} onRenamed={changed}/>}
  />}
  {adding&&<Modal className="owner-create-dialog" title="Add property" onClose={back}><div className="owner-create-body"><PropertyForm integration={integration} houses={[...new Map((data.data??[]).filter(l=>l.houseId).map(l=>[l.houseId!,{id:l.houseId!,name:l.houseName??l.name}])).values()]} draftSaved={changed} created={id=>{changed();router.push(`/admin?property=${encodeURIComponent(id)}`,{scroll:false});}}/></div></Modal>}
 </div>;
}

function AdminJob({ job, user, integration, close, reload }: { job: CleanerJob; user: SessionUser; integration: BloomIntegration; close: () => void; reload: () => void }) {
  const [reason, setReason] = useState('');
  const [checkoutDate, setCheckoutDate] = useState(job.checkoutDate);
  const mutation = useMutation();
  const load = useCallback((signal: AbortSignal) => integration.admin ? integration.admin.assignments(job.id, signal) : Promise.resolve(null), [integration, job.id]);
  const assignments = useResource(load);
  /** Job-level actions; staffing changes live in JobStaffing. */
  async function change(action: 'cancel' | 'keep' | 'reschedule' | 'resolve-cancel') {
    const common = { reason: reason.trim(), expectedVersion: job.version };
    if (!common.reason) return;
    const body = action === 'cancel' ? common : { ...common, action: action === 'resolve-cancel' ? 'cancel' : action, ...(action === 'reschedule' ? { checkoutDate } : {}) };
    const done = await mutation.run({ job: job.id, action, body }, key => request(`/admin/jobs/${encodeURIComponent(job.id)}/${action === 'cancel' ? 'cancel' : 'resolve-change'}`, { body, key }));
    if (done) { close(); reload(); } else { assignments.reload(); reload(); }
  }
  return <article className={styles.detail}><div className={styles.detailToolbar}><h2>Manage job and view photos</h2></div><div className="detail-hero"><h2>{job.propertyName}</h2><p>{formatDate(job.checkoutDate)} · {formatTime(job.startAt, job.timezone)}–{formatTime(job.endAt, job.timezone)} · {job.timezone}</p><p>{job.status} · {job.activeCleanerCount}/2 assigned</p></div><div className="detail-body"><Changes changes={job.changes} />{job.status==='open'&&<JobStaffing job={job} integration={integration} assignments={assignments} onChanged={reload}/>}{job.jobInstructions&&<section aria-label="Job comments"><h3>Job comments</h3><p style={{whiteSpace:'pre-wrap'}}>{job.jobInstructions}</p></section>}{job.status==='open'?<AdminPricingEditor key={`${job.id}:${job.version}`} id={job.id} cents={job.soloRateCents} version={job.version} onSaved={reload}/>:<section className="bloom-admin-card"><h3>Cleaner payout</h3>{job.status==='completed'?(assignments.loading?<Loading/>:assignments.error?<ErrorNotice error={assignments.error} retry={assignments.reload}/>:assignments.data?.length?<ul className="bloom-job-payouts">{assignments.data.map(person=><li key={person.id}><span className="bloom-job-payout-avatar"><CleanerAvatar name={person.cleanerName} url={person.avatarUrl}/></span><span>{person.cleanerName}: <strong>{person.completedPayCents!=null?money(person.completedPayCents):'Payout unavailable'}</strong></span></li>)}</ul>:<p>No cleaner payouts recorded.</p>):<p>Solo {money(job.soloRateCents)} · Shared {money(job.sharedRateCents)} per cleaner</p>}</section>}{job.status==='completed'?<CompletionReport jobId={job.id} propertyName={job.propertyName} date={job.checkoutDate}/>:<Photos job={job} user={user} integration={integration} />}{job.status === 'open' && <div className="bloom-form"><h3>Job changes</h3><label>Reason for change<textarea required value={reason} onChange={event => setReason(event.target.value)} /></label>{job.reviewRequired && <><p className="bloom-notice">Resolve the booking change before claiming or completion can resume.</p><DatePicker label="New checkout date" value={checkoutDate} onChange={setCheckoutDate} /><div className="bloom-actions"><button className="bloom-button" disabled={mutation.busy || !reason.trim()} onClick={() => change('keep')}>Keep schedule</button><button className="bloom-button" disabled={mutation.busy || !reason.trim() || !checkoutDate} onClick={() => change('reschedule')}>Reschedule</button><button className="bloom-button secondary" disabled={mutation.busy || !reason.trim()} onClick={() => change('resolve-cancel')}>Resolve by cancelling</button></div></>}
      <button className="bloom-button secondary" disabled={mutation.busy || !reason.trim()} onClick={() => change('cancel')}>Cancel job</button></div>}<Result mutation={mutation} /></div></article>;
}
function bookingLabel(block: OwnerCalendarBlock) {
  if (block.label) return block.label;
  return block.removed ? 'Removed booking block' : block.kind === 'reservation' ? 'Reservation' : block.kind === 'blocked' ? 'Blocked period' : 'Unconfirmed period';
}
function AdminBooking({ block, close }: { block: OwnerCalendarBlock; close: () => void }) {
  const label = bookingLabel(block);
  return <div className="bloom-owner"><Modal className="bk-card" title={`${block.propertyName} ${label}`} onClose={close}><div className="bk-body"><div className="bk-guest"><span className="bk-guest-label">{label}</span><h2 className="bk-guest-name">{block.propertyName}</h2></div><BookingSourceCard providers={block.providers}/><div className="bk-stay"><div className="bk-stay-end"><span className="bk-stay-cap">{block.kind === 'reservation' ? 'Arrival' : 'Start'}</span><span className="bk-stay-date">{formatDate(block.startDate)}</span></div><div className="bk-stay-line" /><div className="bk-stay-end"><span className="bk-stay-cap">{block.kind === 'reservation' ? 'Checkout' : 'End · exclusive'}</span><span className="bk-stay-date">{formatDate(block.endDate)}</span></div></div><p className="bk-foot-note">{block.timezone}</p>{block.removed && <p className="bloom-notice">{block.providers.includes('manual') ? 'This manual booking was canceled and remains visible for reference.' : 'This block was removed from its source calendar and remains visible for reference.'}</p>}<Changes changes={block.changes} /></div></Modal></div>;
}
const bookingSources=[{id:'all',name:'All sources'},{id:'airbnb',name:'Airbnb'},{id:'vrbo',name:'VRBO'},{id:'external',name:'External'}];
const matchesSource=(block:OwnerCalendarBlock,source:string)=>source==='all'||(source==='external'?!block.providers.some(provider=>provider==='airbnb'||provider==='vrbo'):block.providers.some(provider=>provider===source));
/** Phone calendar state lives in AdminContent because Today / Filters / the type toggle sit in the pinned header. */
type PhoneCalendar={calendarType:'cleanings'|'bookings';setCalendarType:(value:'cleanings'|'bookings')=>void;todayRequest:number;filtersOpen:boolean;setFiltersOpen:(open:boolean)=>void;setFiltersActive:(active:boolean)=>void};
/** One admin bookings month on phones: its own stays request, then the shared owner month grid. */
function AdminPhoneBookingsMonth({month,scope,reloadToken,sourceFilter,visibleIds,selectedDay,onDayChange,onSelect,onCreated}:{month:string;scope:string;reloadToken:number;sourceFilter:string;visibleIds:string[]|null;selectedDay:string|null;onDayChange:(day:string|null)=>void;onSelect:(block:OwnerCalendarBlock)=>void;onCreated:()=>void}){
  const range=monthRange(month);
  const calendar=useCalendar<OwnerCalendarBlock[]>(scope,`/owner/calendar?from=${range.from}&to=${range.to}`);
  const reload=calendar.reload,first=useRef(true);
  useEffect(()=>{if(first.current){first.current=false;return;}reload();},[reloadToken,reload]);
  return <PhoneMonthSection month={month}>{calendar.error?<ErrorNotice error={calendar.error} retry={calendar.reload}/>:<OwnerMonth month={month} day={selectedDay?.startsWith(month)?selectedDay:null} onDayChange={onDayChange} onSelect={onSelect} onCreated={()=>{reload();onCreated();}} initialPropertyId={visibleIds?.length===1?visibleIds[0]:undefined} blocks={(calendar.data??[]).filter(block=>!block.removed&&(!visibleIds||visibleIds.includes(block.propertyId))&&matchesSource(block,sourceFilter))}/>}</PhoneMonthSection>;
}
function Jobs({ user, integration, phone }: { user: SessionUser; integration: BloomIntegration; phone?: PhoneCalendar }) {
  const [localType,setLocalType]=useState<'cleanings'|'bookings'>('cleanings');
  const calendarType=phone?.calendarType??localType;const setCalendarType=phone?.setCalendarType??setLocalType;
  const [phoneJobs,setPhoneJobs]=useState<Record<string,CleanerJob[]>>({});
  const onPhoneJobs=useCallback((month:string,items:CleanerJob[])=>setPhoneJobs(current=>current[month]===items?current:{...current,[month]:items}),[]);
  const [phoneProps,setPhoneProps]=useState<string[]|null>(null);
  const [reloadToken,setReloadToken]=useState(0);
  const [month, setMonth] = useState(todayIn('America/Detroit').slice(0, 7));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<OwnerCalendarBlock | null>(null);
  const [selectedDay,setSelectedDay]=useState<string|null>(null);
  const [propertyFilter, setPropertyFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const loadProperties = useCallback(async (signal: AbortSignal) => {
    if (!integration.admin) return null;
    const items: PropertyOption[] = [];
    let cursor: string | null = null;
    do {
      const page = await integration.admin.properties(cursor, signal);
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor && !signal.aborted);
    return items;
  }, [integration]);
  const properties = useResource(loadProperties);
  const range = monthRange(month);
  const adjacentMonths = [-1, 1].map(offset => {
    const adjacent = monthRange(shiftMonth(month, offset));
    return `/jobs?from=${adjacent.from}&to=${adjacent.to}`;
  });
  const jobs = useCalendar<CleanerJob[]>(`${user.id}:${user.role}`, `/jobs?from=${range.from}&to=${range.to}`, adjacentMonths);
  const bookings=useCalendar<OwnerCalendarBlock[]>(`${user.id}:${user.role}:stays`, `/owner/calendar?from=${range.from}&to=${range.to}`);
  const visibleBookings=(bookings.data??[]).filter(booking=>!booking.removed&&(sourceFilter==='all'||(sourceFilter==='external'?!booking.providers.some(provider=>provider==='airbnb'||provider==='vrbo'):booking.providers.some(provider=>provider===sourceFilter))));
  const visibleJobs = jobs.data?.filter(job => !propertyFilter || job.propertyId === propertyFilter);
  // Phones load each scrolled month separately and filter by the Filters drawer selection.
  const phoneVisible = Object.values(phoneJobs).flat().filter(job => !phoneProps || phoneProps.includes(job.propertyId));
  const dayJobs = phone ? phoneVisible : (visibleJobs ?? []);
  const selected = dayJobs.find(job => job.id === selectedId);
  const reloadAll = () => { jobs.reload(); bookings.reload(); setReloadToken(value => value + 1); };
  const setFiltersActive = phone?.setFiltersActive;
  useEffect(() => { setFiltersActive?.(!!phoneProps || sourceFilter !== 'all'); }, [phoneProps, sourceFilter, setFiltersActive]);
  const phonePill = (job: CleanerJob, date: string) => { const open = job.status === 'open' && job.activeCleanerCount < (job.capacity ?? 2); return <div key={job.id}><button type="button" className={`day-pill${open ? ' open' : ''}`} onClick={() => setSelectedDay(date)} aria-label={`${job.propertyName}, ${formatDate(date)}, ${job.activeCleanerCount} of ${job.capacity ?? 2} assigned, ${job.status}${job.reviewRequired ? ', needs attention' : ''}`}>{open && <span className="dp-plus"><Icon name="plus" size={12}/></span>}<span className="dp-label">{job.propertyName}</span></button>{job.reviewRequired && <span className="bloom-block-notice">Needs attention</span>}</div>; };
  const phoneCounts = (properties.data ?? []).map(item => ({ id: item.id, name: item.name, count: Object.values(phoneJobs).flat().filter(job => job.propertyId === item.id).length }));
  if (phone) return <>
    <div className={calendarType === 'bookings' ? 'bloom-owner' : undefined}><PhoneMonths anchor={month} todayRequest={phone.todayRequest} renderMonth={item => calendarType === 'cleanings'
      ? <CleanerPhoneMonth month={item} scope={`${user.id}:${user.role}`} reloadToken={reloadToken} onJobs={onPhoneJobs} onDaySelect={setSelectedDay} renderDay={(items, date) => items.filter(job => job.checkoutDate === date && (!phoneProps || phoneProps.includes(job.propertyId))).map(job => phonePill(job, date))}/>
      : <AdminPhoneBookingsMonth month={item} scope={`${user.id}:${user.role}:stays`} reloadToken={reloadToken} sourceFilter={sourceFilter} visibleIds={phoneProps} selectedDay={selectedDay} onDayChange={setSelectedDay} onSelect={setSelectedBooking} onCreated={reloadAll}/>}/></div>
    <CalendarFilters open={phone.filtersOpen} onOpenChange={phone.setFiltersOpen} countLabel={['cleaning', 'cleanings']} properties={phoneCounts} selected={phoneProps} onApply={value => { setPhoneProps(value); setSelectedId(null); setSelectedBooking(null); setSelectedDay(null); }}>{calendarType === 'bookings' && <><h3 className="calendar-filter-heading">Calendar source</h3><div className="calendar-filter-sources" role="radiogroup" aria-label="Calendar source">{bookingSources.map(source => <button type="button" role="radio" key={source.id} aria-checked={sourceFilter === source.id} onClick={() => { setSourceFilter(source.id); setSelectedDay(null); }}>{source.name}</button>)}</div></>}</CalendarFilters>
    {selectedDay && !selected && calendarType === 'cleanings' && <CleanerDayDialog creation={{ propertyId: phoneProps?.length === 1 ? phoneProps[0] : '', onCreated: reloadAll, onViewDate: date => { setSelectedDay(date); } }} date={selectedDay} jobs={dayJobs.filter(job => job.checkoutDate === selectedDay)} onSelect={job => { setSelectedId(job.id); }} onClose={() => setSelectedDay(null)}/>}
    {selected?.houseId ? <RoomVisitDialog job={selected} user={user} integration={integration} onClose={() => setSelectedId(null)} onUpdate={reloadAll}/> : selected && <Modal className="cleaner-day-dialog admin-job-dialog bloom-job-frame" title={`Manage cleaning · ${selected.propertyName}`} onClose={() => setSelectedId(null)}><AdminJob key={selected.id} job={selected} user={user} integration={integration} close={() => setSelectedId(null)} reload={reloadAll}/></Modal>}
    {selectedBooking && <AdminBooking block={selectedBooking} close={() => setSelectedBooking(null)}/>}
  </>;
  return <><div className={styles.filters}>{calendarType==='bookings'?<LocationDropdown label="Calendar source" value={sourceFilter} onValueChange={value=>{setSourceFilter(value);setSelectedBooking(null);setSelectedDay(null);}} locations={[{id:'all',name:'All sources'},{id:'airbnb',name:'Airbnb'},{id:'vrbo',name:'VRBO'},{id:'external',name:'External'}]}/>:properties.loading ? <Loading /> : properties.error ? <ErrorNotice error={properties.error} retry={properties.reload} /> : properties.data ? <LocationDropdown label="Filter jobs by property" placeholder="All properties" searchLabel="Search properties" locations={[{ id: '', name: 'All properties' }, ...properties.data]} value={propertyFilter} onValueChange={value => { setPropertyFilter(value); setSelectedId(null); setSelectedBooking(null); setSelectedDay(null); }} /> : <p>Property filtering is unavailable.</p>}</div><div className={`admin-calendar-layout${calendarType==='bookings'?' bloom-owner':''}`}>
    <section className={styles.calendar} aria-label="Cleaning calendar">
      <MonthHead owner={calendarType==='bookings'} beforeToday={<CalendarTypeToggle value={calendarType} onChange={value=>{setCalendarType(value);setSelectedId(null);setSelectedBooking(null);setSelectedDay(null);}}/>} month={month} onDaySelect={setSelectedDay} onMonth={value => { setSelectedId(null); setSelectedBooking(null); setSelectedDay(null); setMonth(value); }} />
      <p className={calendarType==='bookings'?'legend':styles.hint}>{calendarType==='bookings'?'Stays · Blocked · Unconfirmed · Dates are local to each property':'Cleaning dates and windows are local to each property.'}</p>
      {calendarType === 'bookings' ? (bookings.loading ? <Loading /> : bookings.error ? <ErrorNotice error={bookings.error} retry={bookings.reload} /> : <OwnerMonth month={month} blocks={visibleBookings} onSelect={setSelectedBooking} day={selectedDay} onDayChange={setSelectedDay} initialPropertyId={propertyFilter || undefined} onCreated={()=>{jobs.reload();bookings.reload();}} onViewDate={date=>{setMonth(date.slice(0,7));setSelectedDay(date);}} />) : jobs.loading ? <Loading /> : jobs.error ? <ErrorNotice error={jobs.error} retry={jobs.reload} /> : <>
        <BookingCalendar month={month} onDaySelect={setSelectedDay}>{date => <>{visibleJobs?.filter(job => job.checkoutDate === date).map(job => <button type="button" key={job.id} data-cleaning-job={job.id} className={styles.cleaning} data-selected={selectedId === job.id} aria-pressed={selectedId === job.id}
          aria-label={`${job.propertyName}, ${formatDate(job.checkoutDate)}, ${job.status}, ${job.activeCleanerCount} of 2 assigned${job.reviewRequired ? ', needs attention' : ''}`}
          title={`${job.propertyName} · ${formatTime(job.startAt, job.timezone)}–${formatTime(job.endAt, job.timezone)} · ${job.status}`}
          onClick={() => setSelectedDay(date)}>
          <span className={styles.property}>{job.propertyName}</span><span className={styles.status}>{job.reviewRequired ? 'Needs attention' : job.status === 'open' ? `${job.activeCleanerCount}/2 assigned` : job.status}</span>
        </button>)}</>}</BookingCalendar>
        {!visibleJobs?.length && <Empty title="No jobs in this month">Choose another month or property to browse cleanings.</Empty>}
      </>}
    </section>
  </div>
    {selectedDay&&!selected&&!!jobs.data&&calendarType==='cleanings'&&<CleanerDayDialog creation={{propertyId:propertyFilter,onCreated:()=>{jobs.reload();bookings.reload();},onViewDate:date=>{setMonth(date.slice(0,7));setSelectedDay(date);}}} date={selectedDay} jobs={jobs.error?[]:(visibleJobs??[]).filter(job=>job.checkoutDate===selectedDay)} onSelect={job=>{setSelectedId(job.id);}} onClose={()=>{const date=selectedDay;setSelectedDay(null);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(`button[data-calendar-date="${date}"]`)?.focus());}}/>}
    {selected?.houseId?<RoomVisitDialog job={selected} user={user} integration={integration} onClose={()=>setSelectedId(null)} onUpdate={()=>jobs.reload()}/>:selected&&<Modal className="cleaner-day-dialog admin-job-dialog bloom-job-frame" title={`Manage cleaning · ${selected.propertyName}`} onClose={()=>setSelectedId(null)}><AdminJob key={selected.id} job={selected} user={user} integration={integration} close={()=>setSelectedId(null)} reload={jobs.reload}/></Modal>}
    {selectedBooking&&<AdminBooking block={selectedBooking} close={()=>setSelectedBooking(null)}/>}
    </>;
}
function AdminContent({ user, integration, initialPropertyId }: { user: SessionUser; integration: BloomIntegration; initialPropertyId?:string }) {
  const [invitationRevision,setInvitationRevision]=useState(0);
  const router = useRouter();
  const search = useSearchParams();
  const requestedView = search.get('view')==='people'?'users':search.get('view');
  const normalizedView=requestedView==='city requests'?'requests':requestedView;
  const view = initialPropertyId ? 'properties' : ['activity', 'properties', 'users', 'payouts', 'cities', 'requests'].includes(normalizedView ?? '') ? normalizedView! : 'jobs';
  const phone = useIsPhone();
  const [calendarType,setCalendarType]=useState<'cleanings'|'bookings'>('cleanings');
  const [todayRequest,setTodayRequest]=useState(0);
  const [filtersOpen,setFiltersOpen]=useState(false);
  const [filtersActive,setFiltersActive]=useState(false);
  const phoneCalendar = phone && view === 'jobs';
  const go = (item: string) => router.push(`/admin?${new URLSearchParams({view:item})}`);
  const more = ['activity','users','cities','requests'];
  const wallet=<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" style={{display:'block'}}><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M16 11h5v5h-5a2.5 2.5 0 0 1 0-5Z"/></svg>;
  const dots=<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{display:'block'}}><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>;
  const phoneNav=<nav className="phone-view-nav" aria-label="Admin views"><SelectorPill aria-label="Admin views">{(['jobs','properties','payouts'] as const).map(item=><button type="button" key={item} className={`vt-btn${view===item?' active':''}`} aria-current={view===item?'page':undefined} onClick={()=>go(item)}>{item==='payouts'?wallet:<Icon name={item==='jobs'?'grid':'house'}/>}<span>{item==='jobs'?'Calendar':navigationLabel(item)}</span></button>)}<DropdownMenu><DropdownMenuTrigger className={`vt-btn${more.includes(view)?' active':''}`} aria-label="More admin views">{dots}<span>{more.includes(view)?navigationLabel(view):'More'}</span></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuRadioGroup value={view} onValueChange={go}>{more.map(item=><DropdownMenuRadioItem key={item} value={item}>{navigationLabel(item)}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu></SelectorPill></nav>;
  const filterIcon=<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" style={{display:'block'}}><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>;
  return <><header className="topbar bloom-compact-header bloom-admin-header"><Brand role="admin" />{phoneCalendar&&<div className="phone-toolbar"><CalendarTypeToggle value={calendarType} onChange={setCalendarType}/><div className="phone-cal-actions"><button type="button" className="bloom-button secondary" onClick={()=>setTodayRequest(value=>value+1)}>Today</button><button type="button" className="bloom-button secondary phone-filters-button" data-active={filtersActive||undefined} onClick={()=>setFiltersOpen(true)}><ButtonContent icon={filterIcon}>Filters</ButtonContent></button></div></div>}<div className="topbar-right"><HubSelector user={user} view="admin"/><AdminPricingInbox admin/><div className="bloom-header-account">{integration.accountControl?.(user) ?? <Account user={user} />}</div></div></header><main className={`main${view==='properties'?' admin-properties-main':''}`} id="bloom-main"><div className={`main-inner ${(view === 'jobs' || view === 'properties') ? styles.jobsPage : ''}`}>{!phone&&<><MobileViewMenu label="Admin tools" value={view} values={['jobs','activity','properties','users','payouts','cities','requests']} onChange={go}/><SelectorPill className="bloom-admin-tabs" aria-label="Admin tools">{['jobs', 'activity', 'properties', 'users', 'payouts', 'cities', 'requests'].map(item => <button key={item} className={`vt-btn${item === view ? ' active' : ''}`} aria-pressed={item === view} onClick={() => go(item)}>{navigationLabel(item)}</button>)}</SelectorPill></>}{!phoneCalendar&&<h1 className="loc-name">{navigationLabel(view)}</h1>}
    {view === 'activity' && <CleaningActivity hub="admin"/>}
    {view === 'payouts' && <AdminPayouts key={search.get('cleaner')??'all'} initialCleanerId={search.get('cleaner')} onCloseLinkedCleaner={()=>router.replace('/admin?view=payouts')}/>}
    {view === 'jobs' && <Jobs user={user} integration={integration} phone={phone ? {calendarType,setCalendarType,todayRequest,filtersOpen,setFiltersOpen,setFiltersActive} : undefined} />}
    {view === 'properties' && (integration.admin && integration.listCities ? <Properties integration={integration} initialPropertyId={initialPropertyId}/> : unavailable)}
    {view === 'users' && (integration.admin ? <><InvitePerson onSent={()=>setInvitationRevision(v=>v+1)}/><PendingInvitations revision={invitationRevision}/><Paginated loader={integration.admin.users} render={(users, reload) => <div className="admin-people-table-scroll"><table className="admin-people-table"><thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Location</th></tr></thead><tbody>{users.map(item => <UserRow key={item.id} user={item} currentUser={user} reload={reload} />)}</tbody></table>{!users.length&&<p>No people found.</p>}</div>} /></> : unavailable)}
    {view === 'cities' && <ServiceCities/>}
    {view === 'requests' && (integration.admin ? <Paginated loader={integration.admin.cityRequests} render={(items, reload) => <>{items.length ? items.map(item => <RequestRow key={item.id} item={item} reload={reload} integration={integration} />) : <Empty title="No requests" />}</>} /> : unavailable)}

  </div></main>{phone&&phoneNav}</>;
}
export function AdminHub({ integration = noIntegration, initialPropertyId }: { integration?: BloomIntegration; initialPropertyId?:string }) {
  // Phones share the cleaner hub's phone layout (pinned toolbar, stacked months, floating view pill).
  const phone = useIsPhone();
  return <div className={`bloom-cleaner app admin-hub${phone?' cleaner-hub':''}`}><a className="bloom-skip" href="#bloom-main">Skip to content</a><RoleGate role="admin">{user => <AdminContent user={user} integration={integration} initialPropertyId={initialPropertyId}/>}</RoleGate></div>;
}
