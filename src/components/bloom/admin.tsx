'use client';
import {calendarSaveMessage,type CalendarSaveResult} from '../../contracts/calendar-save';

import '../../styles/bloom-owner.css';
import { CalendarSetupSection, initialCalendars } from './calendar-setup-section';
import { AdminPricingInbox, AdminUnitPricing, AdminPricingEditor } from './admin-pricing';
import { CleanerDayDialog } from './cleaner-day-dialog';
import { OwnerListings } from './owner-listings';
import type { OwnerListing, OwnerListingsPage } from '../../contracts/owner-hub';
import { PropertyPeoplePanel } from './property-people';
import { InvitePerson } from './invite-person';
import { DatePicker } from './date-picker';
import { CleaningConfiguration, CompletionReport } from './cleaning-config';
import { PropertyName } from './property-name';
import { LocationDropdown } from './location-dropdown';
import { BookingCalendar } from '../ui/calendar';
import styles from './admin-jobs.module.css';

import { useCallback, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCalendar } from './use-calendar';
import { parseSoloRate, propertyOwnership } from './property-form';
import type { CleanerJob, Role, SessionUser } from '../../contracts';
import { ApiError, request } from './api';
import { formatDate, formatTime, monthRange, money, shiftMonth, todayIn } from './dates';
import type { AdminPerson, BloomIntegration, CityOption, CityRequest, Page, PropertyOption, SourceHealth } from './integration';
import { Account, Brand, HubSelector, Changes, Empty, ErrorNotice, Loading, Modal, MonthHead, RoleGate, useResource } from './primitives';
import { Photos } from './photos';
import { CalendarReviewList } from './calendar-review';

const noIntegration: BloomIntegration = {};
const unavailable = <Empty title="This admin tool is not available yet">The management service must be connected before you can use this tool.</Empty>;
type Run = (input: unknown, operation: (key: string) => Promise<unknown>) => Promise<boolean>;
function useMutation(): { busy: boolean; error: unknown; success: boolean; run: Run } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [success, setSuccess] = useState(false);
  const receipt = useRef<{ input: string; key: string } | null>(null);
  const lock = useRef(false);
  const run: Run = async (input, operation) => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(undefined); setSuccess(false);
    const hash = JSON.stringify(input);
    if (receipt.current?.input !== hash) receipt.current = { input: hash, key: crypto.randomUUID() };
    try { await operation(receipt.current.key); receipt.current = null; setSuccess(true); return true; }
    catch (failure) { setError(failure); if (failure instanceof ApiError && !['NETWORK_ERROR', 'SOURCE_UNAVAILABLE', 'SERVICE_UNAVAILABLE'].includes(failure.code)) receipt.current = null; return false; }
    finally { lock.current = false; setBusy(false); }
  };
  return { busy, error, success, run };
}
function Result({ mutation }: { mutation: ReturnType<typeof useMutation> }) {
  return <>{!!mutation.error && <ErrorNotice error={mutation.error} />}{mutation.success && <p role="status">Saved.</p>}</>;
}
function Paginated<T>({ loader, render }: { loader: (cursor: string | null, signal: AbortSignal) => Promise<Page<T>>; render: (items: T[], reload: () => void) => ReactNode }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const load = useCallback((signal: AbortSignal) => loader(cursor, signal), [loader, cursor]);
  const resource = useResource(load);
  return <>{resource.loading ? <Loading /> : resource.error ? <ErrorNotice error={resource.error} retry={resource.reload} /> : resource.data && <>{render(resource.data.items, resource.reload)}<div className="bloom-actions"><button type="button" className="bloom-button secondary" disabled={!history.length} onClick={() => { setCursor(history[history.length - 1]); setHistory(previous => previous.slice(0, -1)); }}>Previous page</button><button type="button" className="bloom-button secondary" disabled={!resource.data.nextCursor} onClick={() => { setHistory(previous => [...previous, cursor]); setCursor(resource.data!.nextCursor); }}>Next page</button></div></>}</>;
}
function UserRow({ user, currentUser, reload }: { user: AdminPerson; currentUser: SessionUser; reload: () => void }) {
  const mutation = useMutation();
  return <tr><th scope="row">{user.displayName}</th><td>{user.email??'Not available'}</td><td>
    <select aria-label={`Role for ${user.displayName}`} value={user.role} disabled={user.id===currentUser.id||mutation.busy} onChange={async event=>{
      const role=event.target.value as Role;
      if(await mutation.run({role},key=>request(`/admin/users/${encodeURIComponent(user.id)}/role`,{body:{role},key})))reload();
    }}><option value="cleaner">Cleaner</option><option value="owner">Owner</option><option value="admin">Admin</option></select>
    {mutation.busy&&<small role="status">Saving…</small>}
    {user.id===currentUser.id&&<small>Your account</small>}
    {!!mutation.error&&<ErrorNotice error={mutation.error}/>}
  </td><td>{user.location??'—'}</td></tr>;
}

function RequestRow({ item, reload, integration }: { item: CityRequest; reload: () => void; integration: BloomIntegration }) {
  const mutation = useMutation();
  async function decide(decision: 'approved' | 'rejected') {
    if (await mutation.run({ decision }, key => integration.admin!.resolveCityRequest(item.id, decision, key))) reload();
  }
  return <article className="bloom-admin-card"><h3>{item.cleanerName}</h3><p>Requested city: {item.requestedCityName} · {item.status}</p>{item.status === 'pending' && <div className="bloom-actions"><button className="bloom-button" disabled={mutation.busy} onClick={() => decide('approved')}>Approve city change</button><button className="bloom-button secondary" disabled={mutation.busy} onClick={() => decide('rejected')}>Reject</button></div>}<Result mutation={mutation} /></article>;
}
function Cities({ integration }: { integration: BloomIntegration }) {
  const load = useCallback((signal: AbortSignal) => integration.listCities!(signal), [integration]);
  const resource = useResource(load);
  const [name, setName] = useState('');
  const mutation = useMutation();
  async function save(city: CityOption) { if (await mutation.run(city, key => integration.admin!.saveCity!(city, key))) resource.reload(); }
  return <>{resource.loading ? <Loading /> : resource.error ? <ErrorNotice error={resource.error} retry={resource.reload} /> : resource.data?.map(city => <article className="bloom-admin-card" key={city.id}><h3>{city.name}</h3><p>{city.active ? 'Active' : 'Inactive'}</p><button className="bloom-button secondary" disabled={mutation.busy} onClick={() => save({ ...city, active: !city.active })}>{city.active ? 'Deactivate' : 'Activate'}</button></article>)}<form className="bloom-admin-card bloom-form" onSubmit={async event => { event.preventDefault(); const city = { name: name.trim(), active: true }; if (await mutation.run(city, key => integration.admin!.createCity!(city, key))) { setName(''); resource.reload(); } }}><h3>Add city</h3><label>City name<input required value={name} onChange={event => setName(event.target.value)} /></label><button className="bloom-button" disabled={mutation.busy || !name.trim()}>Create city</button></form><Result mutation={mutation} /></>;
}
function PropertyForm({ integration, created }: { integration: BloomIntegration; created: (id:string) => void }) {
  const [draft, setDraft] = useState<Omit<PropertyOption, 'id'>>({ name:'',cityId:'',timezone:'America/Detroit',address:'',instructions:'',isBloomOwned:true,active:true,ownerIds:[],soloRateCents:7500 });
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
  const rateCents = parseSoloRate(rate);
  const mutation=useMutation();
  const citiesLoad=useCallback((signal:AbortSignal)=>integration.listCities!(signal),[integration]);
  const cities=useResource(citiesLoad);
  async function save(event:FormEvent){
    event.preventDefault(); const soloRateCents = parseSoloRate(rate);
    if (soloRateCents === null) { setValidation('Enter a positive USD rate in two-cent increments so it can be split evenly.'); return; }
    const ownership=propertyOwnership(draft.isBloomOwned,ownerMode,draft.ownerIds,ownerEmail);
    if (!ownership) { setValidation("Select an owner account or enter the pending owner’s email."); return; }
    try { new Intl.DateTimeFormat('en-US', { timeZone: draft.timezone }).format(); } catch { setValidation('Enter a valid property timezone, such as America/Detroit.'); return; }
    setValidation('');
    const input={...draft,...ownership,cityId:draft.cityId||cities.data?.find(c=>c.active&&c.name.toLowerCase()==='detroit')?.id||'',soloRateCents};
    await mutation.run(input,async key=>{if(!savedId.current){const result=await integration.admin!.createProperty(input,key);savedId.current=result.id;setSavedProperty(result.id);}
      for(const feed of calendars.filter(feed=>feed.url.trim())){
        const identity=JSON.stringify([feed.provider,feed.url.trim()]);
        let receipt=calendarReceipts.current.get(identity);
        if(!receipt){receipt={key:crypto.randomUUID(),done:false};calendarReceipts.current.set(identity,receipt);}
        if(receipt.done)continue;
        const saved=await request<CalendarSaveResult>(`/admin/properties/${encodeURIComponent(savedId.current)}/calendar-sources`,{body:{provider:feed.provider,url:feed.url.trim()},key:receipt.key});receipt.done=true;setCalendarMessages(items=>[...items,calendarSaveMessage(saved.sync)]);if(saved.sync.status==='failed'||saved.sync.status==='partial')calendarFailed.current=true;
      }
      if(!calendarFailed.current)created(savedId.current);});
  }
  return <form className="bloom-form admin-create-property" onSubmit={save} aria-busy={mutation.busy}><h2>Add Property</h2><fieldset className="property-create-fields" disabled={mutation.busy||!!savedProperty}>
    <label>Name<input required maxLength={200} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
    <label>Ownership<select value={draft.isBloomOwned?'bloom':'owner'} onChange={e=>setDraft({...draft,isBloomOwned:e.target.value==='bloom',ownerIds:[],pendingOwnerEmail:null})}><option value="bloom">Bloom-owned</option><option value="owner">Owner-owned</option></select></label>
    {draft.isBloomOwned?<p>Bloom owns this property. No owner account is required.</p>:<fieldset><legend>Property owner</legend>
      <label>Owner setup<select value={ownerMode} onChange={event=>setOwnerMode(event.target.value as 'existing'|'pending')}><option value="existing">Select an existing owner</option><option value="pending">Owner signs up later</option></select></label>
      {ownerMode==='existing'?<><Paginated loader={integration.admin!.users} render={users=><>{users.filter(u=>u.role==='owner').map(owner=><label className="bloom-check" key={owner.id}><input type="checkbox" checked={draft.ownerIds.includes(owner.id)} onChange={e=>setDraft({...draft,ownerIds:e.target.checked?[...draft.ownerIds,owner.id]:draft.ownerIds.filter(id=>id!==owner.id)})}/>{owner.displayName}</label>)}{!users.some(u=>u.role==='owner')&&<p>No owner accounts on this page. Check other pages, or choose Owner signs up later to associate the property with the email they will verify.</p>}</>}/><p>Select at least one owner. Your admin account is not assigned as the owner.</p></>:<><label>Owner email<input type="email" required maxLength={254} autoComplete="off" value={ownerEmail} onChange={event=>setOwnerEmail(event.target.value)}/></label><p>The property stays pending until the owner signs in with this verified primary email. Share Bloom's sign-in address with them yourself; no invitation is sent. An existing cleaner or admin account may need admin help before it can become an owner.</p></>}
    </fieldset>}
    <label>City<select required value={draft.cityId||cities.data?.find(c=>c.active&&c.name.toLowerCase()==='detroit')?.id||''} onChange={e=>setDraft({...draft,cityId:e.target.value})}><option value="">Choose city</option>{cities.data?.filter(c=>c.active).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    {cities.loading&&<Loading/>}{!!cities.error&&<ErrorNotice error={cities.error} retry={cities.reload}/>}
    <label>Property timezone<input required maxLength={100} value={draft.timezone} onChange={e=>setDraft({...draft,timezone:e.target.value})}/><small>Use an IANA timezone, such as America/Detroit.</small></label>
    <label>Address<textarea required maxLength={500} value={draft.address} onChange={e=>setDraft({...draft,address:e.target.value})}/></label>
    <label>Cleaning instructions<textarea required maxLength={5000} value={draft.instructions} onChange={e=>setDraft({...draft,instructions:e.target.value})}/></label>
    <p>Cleaning window: 11 AM–3 PM on checkout day, in the property's timezone.</p>
    <label>Initial solo rate (USD)<input type="number" required min="0.02" step="0.02" value={rate} onChange={e=>setRate(e.target.value)}/><small>Shared rate: {rateCents === null ? 'Enter a valid solo rate' : money(rateCents/2)} per cleaner. Admins can update cleaner pricing in unit Settings.</small></label>
    </fieldset><CalendarSetupSection calendars={calendars} onChange={setCalendars} disabled={mutation.busy}/>{savedProperty&&<p role="status">Your property is saved. Review calendar results below; saving again will not create another property.</p>}
    {calendarMessages.map((message,index)=><p role="status" key={index}>{message}</p>)}{savedProperty&&<button type="button" className="bloom-button secondary" onClick={()=>created(savedProperty)}>Open saved property</button>}{validation && <p className="bloom-notice" role="alert">{validation}</p>}<button className="bloom-button" disabled={mutation.busy||cities.loading||!!cities.error||!cities.data?.some(c=>c.active)||!propertyOwnership(draft.isBloomOwned,ownerMode,draft.ownerIds,ownerEmail)}>{mutation.busy?'Saving…':savedProperty?'Retry calendar links':'Save property'}</button><Result mutation={mutation}/>
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
 return <article className="bloom-admin-card"><h3>{source.provider==='airbnb'?'Airbnb':'Vrbo'} calendar</h3><p>{source.enabled?'Enabled':'Disabled'} · Last successful sync: {source.lastSuccessAt?new Date(source.lastSuccessAt).toISOString():'Never'}</p><p>Last attempt: {source.lastAttemptAt?new Date(source.lastAttemptAt).toISOString():'Never'}</p>{source.errorMessage&&<p className="bloom-notice" role="alert">{source.errorMessage}</p>}<button className="bloom-button" disabled={mutation.busy||!source.enabled} onClick={sync}>{mutation.busy?'Syncing…':'Sync now'}</button><button type="button" className="bloom-button secondary" disabled={mutation.busy} onClick={reload}>Refresh sync status</button><Result mutation={mutation}/></article>;
}
function SourceForm({propertyId,reload}:{propertyId:string;reload:()=>void}) {
 const [provider,setProvider]=useState('airbnb');const [url,setUrl]=useState('');const mutation=useMutation();const [syncMessage,setSyncMessage]=useState('');
 return <form className="bloom-admin-card bloom-form" onSubmit={async e=>{e.preventDefault();if(await mutation.run({propertyId,provider,url},async key=>{const saved=await request<CalendarSaveResult>(`/admin/properties/${encodeURIComponent(propertyId)}/calendar-sources`,{body:{provider,url},key});setSyncMessage(calendarSaveMessage(saved.sync));})){setUrl('');reload();}}}><h3>Add calendar source</h3><p>The property is already saved. If saving or syncing this calendar fails, the property remains available and you can retry here.</p><p>{provider==='airbnb'?'Paste the Airbnb calendar export link for this property. Use the calendar export (iCal) link, not the listing page or an import link.':'Paste the Vrbo calendar export (iCal) link for this property.'} Links are private.</p><p>Saving a link automatically starts an import. Review its result below. If it fails, the link remains saved and you can choose Sync now to retry.</p><label>Platform<select value={provider} onChange={e=>setProvider(e.target.value)}><option value="airbnb">Airbnb</option><option value="vrbo">Vrbo</option></select></label><label>Private calendar export link<input type="password" autoComplete="off" required maxLength={4096} value={url} onChange={e=>setUrl(e.target.value)}/></label><button className="bloom-button" disabled={mutation.busy}>{mutation.busy?'Saving and syncing…':'Save calendar link'}</button><p role="status">{syncMessage}</p><Result mutation={mutation}/></form>;
}
function PropertySettings({id,integration,back,onRenamed}:{id:string;integration:BloomIntegration;back:()=>void;onRenamed:()=>void}) {
 const load=useCallback((signal:AbortSignal)=>integration.admin!.property(id,signal),[integration,id]);const property=useResource(load);
 const [revision,setRevision]=useState(0);const reload=()=>setRevision(v=>v+1);
 const [syncOutcome,setSyncOutcome]=useState('');
 const [reviewRevision,setReviewRevision]=useState(0);
 const reviews=useCallback((cursor:string|null,signal:AbortSignal)=>request<import('../../contracts').CalendarReviewPage>(`/admin/properties/${encodeURIComponent(id)}/calendar-review${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,{signal}),[id]);
 const sources=useCallback((cursor:string|null,signal:AbortSignal)=>integration.admin!.propertySources(id,cursor,signal),[integration,id]);
 if(property.loading)return <><button type="button" className="bloom-button secondary" onClick={back}>Back to Properties</button><Loading/></>;if(property.error)return <><button className="bloom-button" onClick={back}>Back to Properties</button><ErrorNotice error={property.error} retry={property.reload}/></>;
 const p=property.data!;
 return <><article className="bloom-admin-card"><h2>{p.name}</h2><PropertyName key={p.id} property={p} rename={integration.renameProperty} onSaved={()=>{property.reload();onRenamed();}}/><p>{p.isBloomOwned?'Bloom-owned':`Owner-owned · ${p.ownerIds.length} linked owner account(s)`}</p>{p.pendingOwnerEmail&&<p className="bloom-notice">Pending owner: {p.pendingOwnerEmail}. Access begins after sign-in with this verified primary email. No invitation has been sent.</p>}<p>{p.address}</p><p>11 AM–3 PM · {p.timezone} · Checkout day</p><p>Solo {money(p.soloRateCents)} · Shared {money(p.soloRateCents/2)} per cleaner</p><h3>Cleaning instructions</h3><p className="bloom-prewrap">{p.instructions}</p></article><AdminUnitPricing id={id} onSaved={property.reload}/><CleaningConfiguration propertyId={id}/><PropertyPeoplePanel listing={p}/><h2>Calendar sources</h2><p>Airbnb and Vrbo sources for {p.name}. Links are kept private.</p><Paginated key={revision} loader={sources} render={(items,refresh)=><>{items.length?items.map(s=><SourceRow source={s} reload={()=>{refresh();setReviewRevision(value=>value+1);}} onOutcome={setSyncOutcome} key={s.id}/>):<Empty title="No calendar sources">Add an export link for this property below.</Empty>}</>}/><p role="status">{syncOutcome}</p><SourceForm propertyId={id} reload={reload}/><section aria-label="Flagged calendar entries"><h2>Flagged calendar entries</h2><p>Read-only inspection of blocked, unconfirmed, or source-flagged stays. Dates are local to this property. Classification changes are not available here; use Jobs to resolve changes affecting existing cleanings.</p><Paginated key={reviewRevision} loader={reviews} render={items=><CalendarReviewList entries={items}/>}/></section></>;
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
 const data=useResource(load);const changed=()=>{setRevision(value=>value+1);data.reload();};
 const back=()=>router.push('/admin?view=properties',{scroll:false});
 const range=monthRange(todayIn('UTC').slice(0,7));
 return <div className="bloom-owner admin-properties-workspace">
  {data.loading?<Loading/>:data.error?<ErrorNotice error={data.error} retry={data.reload}/>:<OwnerListings listings={data.data??[]} initialSelectedId={initialPropertyId} integration={integration} onChanged={changed} from={range.from} toExclusive={range.to} revision={revision}
   addListingAction={<div className="bloom-actions"><button className="bloom-button secondary" onClick={changed}>Refresh</button><Link className="bloom-button" href="/admin?view=properties&new=1" scroll={false}>+ Add listing</Link></div>}
   renderSettings={listing=><PropertySettings key={listing.id} id={listing.id} integration={integration} back={back} onRenamed={changed}/>}
  />}
  {adding&&<Modal className="owner-create-dialog" title="Add property" onClose={back}><div className="owner-create-body"><PropertyForm integration={integration} created={id=>{changed();router.push(`/admin?property=${encodeURIComponent(id)}`,{scroll:false});}}/></div></Modal>}
 </div>;
}

function AdminJob({ job, user, integration, close, reload }: { job: CleanerJob; user: SessionUser; integration: BloomIntegration; close: () => void; reload: () => void }) {
  const [reason, setReason] = useState('');
  const [cleanerId, setCleanerId] = useState('');
  const [removeAssignmentId, setRemoveAssignmentId] = useState('');
  const [checkoutDate, setCheckoutDate] = useState(job.checkoutDate);
  const mutation = useMutation();
  const load = useCallback((signal: AbortSignal) => integration.admin ? integration.admin.assignments(job.id, signal) : Promise.resolve(null), [integration, job.id]);
  const assignments = useResource(load);
  async function change(action: 'cancel' | 'reassign' | 'keep' | 'reschedule' | 'resolve-cancel' | 'assign') {
    const common = { reason: reason.trim(), expectedVersion: job.version };
    if (!common.reason) return;
    const body = action === 'reassign' ? { ...common, removeAssignmentId, cleanerId } : action === 'cancel' ? common : { ...common, action: action === 'resolve-cancel' ? 'cancel' : action, ...(action === 'reschedule' ? { checkoutDate } : {}) };
    const done = await mutation.run({ job: job.id, action, body, cleanerId }, key => action === 'assign' ? integration.admin!.assignJob!(job.id, { ...common, cleanerId }, key) : request(`/admin/jobs/${encodeURIComponent(job.id)}/${action === 'cancel' || action === 'reassign' ? action : 'resolve-change'}`, { body, key }));
    if (done) { close(); reload(); } else { assignments.reload(); reload(); }
  }
  return <article className={styles.detail}><div className={styles.detailToolbar}><h2>Manage job and view photos</h2></div><div className="detail-hero"><h2>{job.propertyName}</h2><p>{formatDate(job.checkoutDate)} · {formatTime(job.startAt, job.timezone)}–{formatTime(job.endAt, job.timezone)} · {job.timezone}</p><p>{job.status} · {job.activeCleanerCount}/2 assigned</p></div><div className="detail-body"><Changes changes={job.changes} />{job.status==='open'?<AdminPricingEditor key={`${job.id}:${job.version}`} id={job.id} cents={job.soloRateCents} version={job.version} onSaved={reload}/>:<section className="bloom-admin-card"><h3>Cleaner payout</h3><p>Solo {money(job.soloRateCents)} · Shared {money(job.sharedRateCents)} per cleaner</p></section>}<Photos job={job} user={user} integration={integration} />{job.status==='completed'&&<CompletionReport jobId={job.id}/>}{job.status === 'open' && <div className="bloom-form"><label>Reason for change<textarea required value={reason} onChange={event => setReason(event.target.value)} /></label>{job.reviewRequired && <><p className="bloom-notice">Resolve the booking change before claiming or completion can resume.</p><DatePicker label="New checkout date" value={checkoutDate} onChange={setCheckoutDate} /><div className="bloom-actions"><button className="bloom-button" disabled={mutation.busy || !reason.trim()} onClick={() => change('keep')}>Keep schedule</button><button className="bloom-button" disabled={mutation.busy || !reason.trim() || !checkoutDate} onClick={() => change('reschedule')}>Reschedule</button><button className="bloom-button secondary" disabled={mutation.busy || !reason.trim()} onClick={() => change('resolve-cancel')}>Resolve by cancelling</button></div></>}
      {integration.admin ? <><Paginated loader={integration.admin.users} render={users => <fieldset><legend>Cleaner</legend>{users.filter(item => item.role === 'admin' || (item.role === 'cleaner' && item.approvedCityId === job.cityId)).map(cleaner => <label className="bloom-check" key={cleaner.id}><input type="radio" name="assignment-cleaner" checked={cleanerId === cleaner.id} onChange={() => setCleanerId(cleaner.id)} />{cleaner.displayName}</label>)}</fieldset>} />{assignments.loading ? <Loading /> : assignments.error ? <ErrorNotice error={assignments.error} retry={assignments.reload} /> : <label>Replace assignment<select value={removeAssignmentId} onChange={event => setRemoveAssignmentId(event.target.value)}><option value="">Choose assignment</option>{assignments.data?.map(item => <option key={item.id} value={item.id}>{item.cleanerName}</option>)}</select></label>}<div className="bloom-actions"><button className="bloom-button" disabled={!integration.admin.assignJob || mutation.busy || !cleanerId || !reason.trim() || job.activeCleanerCount >= 2} onClick={() => change('assign')}>Assign open slot</button><button className="bloom-button" disabled={mutation.busy || !cleanerId || !reason.trim() || !removeAssignmentId} onClick={() => change('reassign')}>Reassign cleaner</button></div></> : <p>Assignment management is not available yet.</p>}
      <button className="bloom-button secondary" disabled={mutation.busy || !reason.trim()} onClick={() => change('cancel')}>Cancel job</button></div>}<Result mutation={mutation} /></div></article>;
}
function Jobs({ user, integration }: { user: SessionUser; integration: BloomIntegration }) {
  const [month, setMonth] = useState(todayIn('America/Detroit').slice(0, 7));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDay,setSelectedDay]=useState<string|null>(null);
  const [propertyFilter, setPropertyFilter] = useState('');
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
  const [propertyId, setPropertyId] = useState('');
  const [checkoutDate, setCheckoutDate] = useState('');
  const range = monthRange(month);
  const adjacentMonths = [-1, 1].map(offset => {
    const adjacent = monthRange(shiftMonth(month, offset));
    return `/jobs?from=${adjacent.from}&to=${adjacent.to}`;
  });
  const jobs = useCalendar<CleanerJob[]>(`${user.id}:${user.role}`, `/jobs?from=${range.from}&to=${range.to}`, adjacentMonths);
  const mutation = useMutation();
  const visibleJobs = jobs.data?.filter(job => !propertyFilter || job.propertyId === propertyFilter);
  const selected = visibleJobs?.find(job => job.id === selectedId);
  return <><div className={styles.filters}>{properties.loading ? <Loading /> : properties.error ? <ErrorNotice error={properties.error} retry={properties.reload} /> : properties.data ? <LocationDropdown label="Filter jobs by property" placeholder="All properties" searchLabel="Search properties" locations={[{ id: '', name: 'All properties' }, ...properties.data]} value={propertyFilter} onValueChange={value => { setPropertyFilter(value); setSelectedId(null); setSelectedDay(null); }} /> : <p>Property filtering is unavailable.</p>}</div><div className="admin-calendar-layout">
    <section className={styles.calendar} aria-label="Cleaning calendar">
      <MonthHead month={month} onDaySelect={setSelectedDay} onMonth={value => { setSelectedId(null); setSelectedDay(null); setMonth(value); }} />
      <p className={styles.hint}>Cleaning dates and windows are local to each property.</p>
      {jobs.loading ? <Loading /> : jobs.error ? <ErrorNotice error={jobs.error} retry={jobs.reload} /> : <>
        <BookingCalendar month={month} onDaySelect={setSelectedDay}>{date => visibleJobs?.filter(job => job.checkoutDate === date).map(job => <button type="button" key={job.id} data-cleaning-job={job.id} className={styles.cleaning} data-selected={selectedId === job.id} aria-pressed={selectedId === job.id}
          aria-label={`${job.propertyName}, ${formatDate(job.checkoutDate)}, ${job.status}, ${job.activeCleanerCount} of 2 assigned${job.reviewRequired ? ', needs attention' : ''}`}
          title={`${job.propertyName} · ${formatTime(job.startAt, job.timezone)}–${formatTime(job.endAt, job.timezone)} · ${job.status}`}
          onClick={() => setSelectedDay(date)}>
          <span className={styles.property}>{job.propertyName}</span><span className={styles.status}>{job.reviewRequired ? 'Needs attention' : job.status === 'open' ? `${job.activeCleanerCount}/2 assigned` : job.status}</span>
        </button>)}</BookingCalendar>
        {!visibleJobs?.length && <Empty title="No jobs in this month">Choose another month or property to browse cleanings.</Empty>}
      </>}
    </section>
  </div>
    {selectedDay&&!selected&&!jobs.loading&&!jobs.error&&<CleanerDayDialog date={selectedDay} jobs={jobs.error?[]:(visibleJobs??[]).filter(job=>job.checkoutDate===selectedDay)} onSelect={job=>{setSelectedId(job.id);}} onClose={()=>{const date=selectedDay;setSelectedDay(null);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(`button[data-calendar-date="${date}"]`)?.focus());}}/>}
    {selected&&<Modal className="cleaner-day-dialog admin-job-dialog" title={`Manage cleaning · ${selected.propertyName}`} onClose={()=>setSelectedId(null)}><AdminJob key={selected.id} job={selected} user={user} integration={integration} close={()=>setSelectedId(null)} reload={jobs.reload}/></Modal>}
    {integration.admin?.createJob && <form className="bloom-admin-card bloom-form" onSubmit={async event => { event.preventDefault(); const input = { propertyId, checkoutDate }; if (await mutation.run(input, key => integration.admin!.createJob!(input, key))) jobs.reload(); }}><h3>Create cleaning</h3><Paginated loader={integration.admin.properties} render={properties => <fieldset><legend>Property</legend>{properties.filter(property => property.active).map(property => <label className="bloom-check" key={property.id}><input type="radio" name="job-property" checked={propertyId === property.id} onChange={() => setPropertyId(property.id)} />{property.name} · {property.timezone}</label>)}</fieldset>} /><DatePicker label="Checkout day" value={checkoutDate} onChange={setCheckoutDate} /><p>11 AM–3 PM in the property’s local timezone.</p><button className="bloom-button" disabled={mutation.busy || !propertyId}>Create job</button><Result mutation={mutation} /></form>}</>;
}
function AdminContent({ user, integration, initialPropertyId }: { user: SessionUser; integration: BloomIntegration; initialPropertyId?:string }) {
  const router = useRouter();
  const search = useSearchParams();
  const requestedView = search.get('view')==='people'?'users':search.get('view');
  const view = initialPropertyId ? 'properties' : ['properties', 'users', 'cities', 'city requests'].includes(requestedView ?? '') ? requestedView! : 'jobs';
  return <><header className="topbar"><Brand role="admin" /><div className="topbar-right"><HubSelector user={user} view="admin"/><AdminPricingInbox/>{integration.accountControl?.(user) ?? <Account user={user} />}</div></header><main className={`main${view==='properties'?' admin-properties-main':''}`} id="bloom-main"><div className={`main-inner ${(view === 'jobs' || view === 'properties') ? styles.jobsPage : ''}`}><nav className="bloom-admin-tabs" aria-label="Admin tools">{['jobs', 'properties', 'users', 'cities', 'city requests'].map(item => <button key={item} className={`city-tab${item === view ? ' active' : ''}`} aria-pressed={item === view} onClick={() => router.push(`/admin?${new URLSearchParams({view:item})}`)}>{item==='users'?'People':item}</button>)}</nav><h1 className="loc-name">{view==='users'?'People':view.slice(0, 1).toUpperCase() + view.slice(1)}</h1>
    {view === 'jobs' && <Jobs user={user} integration={integration} />}
    {view === 'properties' && (integration.admin && integration.listCities ? <Properties integration={integration} initialPropertyId={initialPropertyId}/> : unavailable)}
    {view === 'users' && (integration.admin ? <><InvitePerson/><Paginated loader={integration.admin.users} render={(users, reload) => <div className="admin-people-table-scroll"><table className="admin-people-table"><thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Location</th></tr></thead><tbody>{users.map(item => <UserRow key={item.id} user={item} currentUser={user} reload={reload} />)}</tbody></table>{!users.length&&<p>No people found.</p>}</div>} /></> : unavailable)}
    {view === 'cities' && (integration.admin?.saveCity && integration.admin.createCity && integration.listCities ? <Cities integration={integration} /> : unavailable)}
    {view === 'city requests' && (integration.admin ? <Paginated loader={integration.admin.cityRequests} render={(items, reload) => <>{items.length ? items.map(item => <RequestRow key={item.id} item={item} reload={reload} integration={integration} />) : <Empty title="No city change requests" />}</>} /> : unavailable)}

  </div></main></>;
}
export function AdminHub({ integration = noIntegration, initialPropertyId }: { integration?: BloomIntegration; initialPropertyId?:string }) {
  return <div className="bloom-cleaner app"><a className="bloom-skip" href="#bloom-main">Skip to content</a><RoleGate role="admin">{user => <AdminContent user={user} integration={integration} initialPropertyId={initialPropertyId}/>}</RoleGate></div>;
}
