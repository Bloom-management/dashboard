'use client';
import {CleanerPayouts} from './cleaner-payouts';
import {DialogLoading} from './dialog-loading';
import {SupplyPreview,MaintenancePreview} from './maintenance';
import {PersonAvatar} from './person-avatar';
import {SelectorPill} from './selector-pill';
import {NotificationInbox} from '../push/inbox';

import {navigationLabel} from './navigation-labels';

import {useSearchParams} from 'next/navigation';
import {notificationDate} from '../../contracts/push-navigation';
import {PushSettings} from '../push/settings';
import {CleanerDayDialog} from './cleaner-day-dialog';
import { MaintenanceGrid, JobSupplies } from './maintenance';
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CleanerJob, SessionUser } from '../../contracts';
import { api, ApiError, request } from './api';
import { formatDate, formatTime, monthRange, money, todayIn } from './dates';
import type { BloomIntegration } from './integration';
import { Account, Brand, HubSelector, CalendarGrid, Changes, Empty, ErrorNotice, Icon, Loading, Modal, MonthHead, PropertyRail, RoleGate, useResource } from './primitives';
import { useCalendar } from './use-calendar';
import { Photos } from './photos';
import { CleanerJourney } from './cleaner-journey';
import { LocationDropdown } from './location-dropdown';
import { mayClaim, mayWithdraw } from './job-policy';

const noIntegration: BloomIntegration = {};

function CityPicker({ user, refresh, integration }: { user: SessionUser; refresh: () => void; integration: BloomIntegration }) {
  const load = useCallback((signal: AbortSignal) => integration.listCities ? integration.listCities(signal) : Promise.resolve(null), [integration]);
  const cities = useResource(load);
  const pendingLoad = useCallback((signal: AbortSignal) => integration.getMyCityRequest ? integration.getMyCityRequest(signal) : Promise.resolve(null), [integration]);
  const pending = useResource(pendingLoad);
  const [city, setCity] = useState('');
  const [cityDialog,setCityDialog]=useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [sent, setSent] = useState(false);
  const alternatives=cities.data?.filter(item=>item.active&&item.id!==user.approvedCityId)??[];
  const operation = useRef<{ city: string; key: string } | null>(null);
  const locked = useRef(false);

  async function submit() {
    if (!city || locked.current) return;
    locked.current = true; setBusy(true); setError(undefined);
    if (operation.current?.city !== city) operation.current = { city, key: crypto.randomUUID() };
    try {
      if (user.approvedCityId) { await api.requestCity(city, operation.current.key); setSent(true); pending.reload(); }
      else { await api.selectCity(city, operation.current.key); refresh(); }
      operation.current = null;
    } catch (failure) { setError(failure); if (failure instanceof ApiError && !['NETWORK_ERROR', 'SOURCE_UNAVAILABLE', 'SERVICE_UNAVAILABLE'].includes(failure.code)) operation.current = null; }
    finally { locked.current = false; setBusy(false); }
  }
  return <div className="city-tabs"><button type="button" className="bloom-button secondary cleaner-city-trigger" onClick={()=>setCityDialog(true)}><Icon name="pin"/>{user.approvedCityId?cities.data?.find(item=>item.id===user.approvedCityId)?.name??'Your city':'Choose city'}<Icon name="right"/></button>{cityDialog&&<Modal className="owner-create-dialog cleaner-city-dialog" title="Change city" onClose={()=>setCityDialog(false)}><div className="cleaner-city-body"><h2>{user.approvedCityId?'Request a city change':'Choose your first city'}</h2><p>Current city: <span>{user.approvedCityId ? cities.data?.find(city => city.id === user.approvedCityId)?.name ?? 'Your approved city' : 'Not selected'}</span></p>
    {cities.loading ? <Loading /> : cities.error ? <ErrorNotice error={cities.error} retry={cities.reload} /> : cities.data ? alternatives.length ? <><LocationDropdown label={user.approvedCityId ? 'Request a different city' : 'Initial city'} placeholder={user.approvedCityId ? 'Request city change' : 'Select city'} value={city} onValueChange={value => { setCity(value); setSent(false); }} disabled={busy || pending.data?.status === 'pending'} locations={alternatives} /><button className="city-tab active" disabled={!city || busy || sent || pending.data?.status === 'pending'} onClick={submit}>{busy ? 'Saving…' : user.approvedCityId ? 'Request change' : 'Save city'}</button></> : <p role="status">{user.approvedCityId?'No alternative locations available right now.':'No locations available right now.'}</p> : <span>City selection is unavailable. Contact your admin.</span>}
    {(sent || pending.data?.status === 'pending') && <span role="status">City change awaiting admin approval. Your approved city stays active.</span>}{!!pending.error && <ErrorNotice error={pending.error} retry={pending.reload} />}{!!error && <ErrorNotice error={error} />}
  </div></Modal>}</div>;
}

function Instructions({ job, integration, isAdmin }: { job: CleanerJob; integration: BloomIntegration; isAdmin:boolean }) {
  const loader = useCallback((signal:AbortSignal)=>(job.myAssignmentId||isAdmin)&&integration.getInstructions?integration.getInstructions(job.id,signal,job.propertyId):Promise.resolve(null),[integration,job.id,job.propertyId,job.myAssignmentId,isAdmin]);
  const notes=useResource(loader);
  if(!job.myAssignmentId&&!isAdmin)return <p>Instructions are available after claiming this cleaning.</p>;
  if(notes.loading)return <DialogLoading/>;
  return <div className="instr-card">{notes.error?<ErrorNotice error={notes.error} retry={notes.reload}/>:notes.data?<><p className="instr-body bloom-prewrap">{notes.data.instructions||'No instructions provided.'}</p>{notes.data.address&&<p>{notes.data.address}</p>}</>:<p>Instructions are unavailable. Contact your admin before visiting.</p>}</div>;
}

export function JobDetail({ job, user, integration, onClose, onUpdate, refresh }: { job: CleanerJob; user: SessionUser; integration: BloomIntegration; onClose: () => void; onUpdate: (job: CleanerJob) => void; refresh: () => void }) {
  const loadTeam=useCallback((signal:AbortSignal)=>request<{id:string;displayName:string}[]>(`/jobs/${job.id}/team`,{signal}),[job.id]);
  const team=useResource(loadTeam);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>();
  const [coverage, setCoverage] = useState(false);
  const [now, setNow] = useState(Date.now());
  const operation = useRef<{ action: string; key: string } | null>(null);
  const locked = useRef(false);
  const [screenHeight,setScreenHeight]=useState<number>();
  const [detailScreen,setDetailScreen]=useState<'Notes'|'Supplies'|'Maintenance'|null>(null);
  const screenHeading=useRef<HTMLHeadingElement>(null);
  const screenTrigger=useRef<string|null>(null);
  useEffect(()=>{if(detailScreen)screenHeading.current?.focus();else if(screenTrigger.current)document.querySelector<HTMLButtonElement>(`[data-cleaning-section="${screenTrigger.current}"]`)?.focus({preventScroll:true});},[detailScreen]);
  const mounted = useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  async function transitionJob(updated:CleanerJob) {
    const change=()=>flushSync(()=>onUpdate(updated));
    if(document.startViewTransition&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const transition=document.startViewTransition(change);
      await transition.finished.catch(()=>{});
    } else change();
  }
  async function journeyUpdate(updated:CleanerJob) {
    if(updated.myAssignmentId){onUpdate(updated);return;}
    setBusy('withdraw');
    await transitionJob(updated);
    if(!mounted.current)return;
    const card=document.querySelector<HTMLDialogElement>('dialog.bloom-job-surface');
    if(card&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await new Promise(resolve=>setTimeout(resolve,180));
      if(!mounted.current)return;
      await card.animate([{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:'translateY(8px) scale(.98)'}],{duration:180,easing:'ease-in',fill:'forwards'}).finished.catch(()=>{});
    }
    if(mounted.current)onClose();
  }

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const withdrawalAllowed = mayWithdraw(job, now);
  const canClaim = (user.role === 'cleaner' || user.role === 'admin') && mayClaim(job, now);
  async function act(action: 'claim' | 'withdraw' | 'complete') {
    if (!['cleaner', 'admin'].includes(user.role) || locked.current) return;
    locked.current = true; setBusy(action); setError(undefined);
    if (operation.current?.action !== action) operation.current = { action, key: crypto.randomUUID() };
    try { const updated = await api.jobAction(job.id, action, operation.current.key); await transitionJob(updated); operation.current = null; }
    catch (failure) {
      setError(failure);
      if (failure instanceof ApiError && !['NETWORK_ERROR', 'SOURCE_UNAVAILABLE', 'SERVICE_UNAVAILABLE'].includes(failure.code)) operation.current = null;
      // Refetch after every rejection, including another cleaner winning the final slot.
      refresh();
    } finally { locked.current = false; setBusy(null); }
  }
  if (job.myAssignmentId) return <CleanerJourney key={job.id} job={job} user={user} integration={integration} onClose={onClose} onUpdate={journeyUpdate} />;
  if(detailScreen)return <Modal showClose={false} style={{height:screenHeight}} className="detail-card job-detail-compact bloom-job-surface bloom-job-detail-screen" title={`${job.propertyName} · ${detailScreen}`} onClose={onClose}><div className="detail-body bloom-job-subscreen"><button type="button" className="bloom-job-back" onClick={()=>setDetailScreen(null)}>← Back to cleaning</button><h2 ref={screenHeading} tabIndex={-1}>{detailScreen}</h2><p>{job.propertyName}</p>{detailScreen==='Notes'?<Instructions job={job} integration={integration} isAdmin={user.role==='admin'}/>:detailScreen==='Supplies'?<JobSupplies jobId={job.id} compact={false}/>:<MaintenanceGrid showHeading={false}/>}</div></Modal>;
  return <Modal className="detail-card job-detail-compact bloom-job-surface" title={`${job.propertyName} cleaning details`} onClose={onClose}><div className="detail-hero"><div className="detail-date">{formatDate(job.checkoutDate)}</div><div className="assign-row">{[0, 1].map(index => <div className="assign-slot" key={index}>{index < job.activeCleanerCount ? <span className="open-circle bloom-slot"><PersonAvatar/></span> : <button className="join-btn" disabled={!canClaim || !!busy} onClick={() => act('claim')} aria-label={`Claim open cleaning slot ${index + 1}`}><Icon name="plus" size={26} /></button>}<span className="assign-name">{index < job.activeCleanerCount ? (team.data?.[index]?.displayName ?? (job.activeCleanerCount===1&&job.myAssignmentId?user.displayName:'Cleaner')) : 'Open slot'}</span></div>)}</div><h2 className="detail-headline">{job.propertyName}</h2><div className="fill-chip">{job.activeCleanerCount}/2 cleaners · {job.status}</div></div>
    <div className="detail-body"><Changes changes={job.changes} />{job.reviewRequired && <p className="bloom-notice">Booking changes need admin attention. Claiming and completion are paused.</p>}
      <div className="info-row"><div className="row-head">Cleaning window</div><div className="window-track"><div className="win-end"><span className="win-time">{formatTime(job.startAt, job.timezone)}</span><span className="win-cap">Start</span></div><div className="win-line" /><div className="win-end"><span className="win-time">{formatTime(job.endAt, job.timezone)}</span><span className="win-cap">Finish</span></div></div><p className="window-note">{formatDate(job.checkoutDate)} · {job.timezone}</p></div>
      {job.status === 'open' && !job.myAssignmentId && now >= Date.parse(job.endAt) && <p className="bloom-notice">The cleaning window has ended. New claims closed at {formatTime(job.endAt, job.timezone)} in {job.timezone}. Choose a future cleaning to claim a slot.</p>}
      {user.role === 'admin' && <p className="bloom-notice">Cleaning as yourself · Admin access stays active.</p>}<nav className="bloom-job-sections" aria-label="Cleaning information">{(['Notes','Supplies','Maintenance'] as const).map(label=><button type="button" className={label==='Notes'?'pill-row':'bloom-section-folder'} key={label} data-cleaning-section={label} onClick={event=>{setScreenHeight(event.currentTarget.closest('dialog')?.getBoundingClientRect().height);screenTrigger.current=label;setDetailScreen(label);}}>{label==='Notes'?<><span className="row-head">Notes</span><span className="pill-cta">View notes <Icon name="right"/></span></>:<>{label==='Supplies'?<SupplyPreview jobId={job.id}/>:<MaintenancePreview/>}<span className="row-head">{label}</span></>}</button>)}</nav>
      <div className="payout"><div className="row-head">{job.status === 'completed' ? 'Completed cleaning' : 'Provisional cleaning rate'}</div>{job.myCompletedPayCents !== null ? <div className="pt-amount">{money(job.myCompletedPayCents)}</div> : <><div className="payout-tiles"><div className="payout-tile"><div className="pt-amount">{money(job.soloRateCents)}</div><div className="pt-label">Solo</div><div className="pt-sub">one cleaner</div></div><div className="payout-tile"><div className="pt-amount">{money(job.sharedRateCents)}</div><div className="pt-label">Together</div><div className="pt-sub">per cleaner, when two</div></div></div><p className="payout-note">Provisional until completion. The second slot remains available.</p></>}</div>
      {job.myAssignmentId && <Photos key={`${job.id}-${job.myAssignmentId}`} job={job} user={user} integration={integration} onCoverage={setCoverage} />}
      {!!error && <ErrorNotice error={error} />}{busy && <p role="status">{busy === 'claim' ? 'Claiming your slot…' : busy === 'withdraw' ? 'Withdrawing…' : 'Completing job…'}</p>}
      {(user.role === 'cleaner' || user.role === 'admin') && !job.myAssignmentId && <button className="bloom-button" disabled={!canClaim || !!busy} onClick={() => act('claim')}>{job.activeCleanerCount >= 2 ? 'Both slots are taken' : 'Claim this cleaning'}</button>}
      {(user.role === 'cleaner' || user.role === 'admin') && job.myAssignmentId && job.status === 'open' && <><button className="bloom-button" disabled={!!busy || !coverage || job.reviewRequired || now < Date.parse(job.startAt)} onClick={() => act('complete')}>Complete whole job</button><p className="window-note">One assigned cleaner completes the job for everyone. {now < Date.parse(job.startAt) ? 'Completion opens at the cleaning start time.' : !coverage ? 'Add a ready photo in each room category first.' : 'The server checks all requirements before completing.'}</p>{withdrawalAllowed ? <button className="pill-row" disabled={!!busy} onClick={() => act('withdraw')}>Withdraw from this cleaning</button> : <p className="bloom-notice">It is less than six hours before the start. Contact your admin for reassignment.</p>}</>}
    </div></Modal>;
}

function CleanerContent({ user, refreshUser, integration }: { user: SessionUser; refreshUser: () => void; integration: BloomIntegration }) {
  const search=useSearchParams();const targetDate=notificationDate(search.get('date'));
  const [availableOnly,setAvailableOnly]=useState(search.get('view')==='calendar'&&search.get('city')===user.approvedCityId);
  const [dayFilter,setDayFilter]=useState<string|null>(search.get('view')==='upcoming'?targetDate:null);
  const [month, setMonth] = useState(() => (targetDate??todayIn('America/Detroit')).slice(0, 7));
  const [view, setView] = useState<'calendar' | 'upcoming' | 'payouts'>(search.get('view')==='payouts'?'payouts':search.get('view')==='upcoming'?'upcoming':'calendar');
  const [property, setProperty] = useState('');
  const [selected, setSelected] = useState<CleanerJob | null>(null);
  const [selectedDay,setSelectedDay]=useState<string|null>(null);
  const range = monthRange(month);
  const [adminCity, setAdminCity] = useState('');
  const citiesLoad = useCallback((signal: AbortSignal) => user.role === 'admin' && integration.listCities ? integration.listCities(signal) : Promise.resolve([]), [integration, user.role]);
  const cities = useResource(citiesLoad);
  const cityId = user.role === 'admin' ? adminCity || cities.data?.find(city => city.name.toLowerCase() === 'detroit')?.id || cities.data?.[0]?.id : user.approvedCityId;
  const jobs = useCalendar<CleanerJob[]>(`${user.id}:${user.role}:${user.approvedCityId ?? ''}`, `/jobs?from=${range.from}&to=${range.to}`);
  useEffect(() => {
    if (jobs.error instanceof ApiError && ['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'].includes(jobs.error.code)) setSelected(null);
  }, [jobs.error]);
  useEffect(() => {
    if (!jobs.data) return;
    setSelected(current => current ? jobs.data!.find(job => job.id === current.id) ?? null : null);
  }, [jobs.data]);
  const cityJobs = (jobs.data ?? []).filter(job => user.role !== 'admin' || job.cityId === cityId);
  const properties = Array.from(new Map(cityJobs.map(job => [job.propertyId, { id: job.propertyId, name: job.propertyName }])).values());
  const visible = cityJobs.filter(job => (!property || job.propertyId === property)&&(!availableOnly||mayClaim(job,Date.now())));
  const upcoming = visible.filter(job => (!dayFilter||job.checkoutDate===dayFilter)&&job.myAssignmentId && job.status === 'open' && Date.parse(job.endAt) >= Date.now()).sort((a, b) => a.startAt.localeCompare(b.startAt));
  function changeMonth(value: string) { setDayFilter(null); setSelectedDay(null); setSelected(null); setMonth(value); }
  return <><header className="topbar bloom-compact-header"><Brand role="cleaner" />{user.role === 'admin' ? <div className="bloom-city"><LocationDropdown label="City filter" value={cityId ?? ''} onValueChange={value => { setAdminCity(value); setProperty(''); setSelected(null); }} locations={cities.data ?? []} disabled={cities.loading || !!cities.error} />{cities.loading && <Loading />}{!!cities.error && <ErrorNotice error={cities.error} retry={cities.reload} />}</div> : <CityPicker user={user} refresh={refreshUser} integration={integration} />}<div className="topbar-right"><HubSelector user={user} view="cleaner" /><SelectorPill aria-label="Cleaner views">{(['calendar', 'upcoming', 'payouts'] as const).map(tab => <button key={tab} className={`vt-btn${view === tab ? ' active' : ''}`} aria-label={tab === 'calendar' ? 'Available-job calendar' : tab === 'payouts' ? 'My payouts' : 'My upcoming jobs'} aria-pressed={view === tab} onClick={() => {setView(tab);setAvailableOnly(false);}}>{tab==='payouts'?<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M16 11h5v5h-5a2.5 2.5 0 0 1 0-5Z"/></svg>:<Icon name={tab === 'calendar' ? 'grid' : 'list'} />}<span>{navigationLabel(tab)}</span></button>)}</SelectorPill><NotificationInbox cleaner={user.role==='cleaner'}/><div className="bloom-header-account">{integration.accountControl?.(user) ?? <Account user={user} />}</div></div></header><div className="body">{view!=='payouts'&&<PropertyRail properties={properties} selected={property} onSelect={setProperty} />}<main className="main" id="bloom-main"><div className="main-inner">
    {view==='payouts'?<CleanerPayouts/>:<>{user.role==='cleaner'&&<PushSettings/>}
    {availableOnly&&<p>Showing available jobs in your approved city. <button className="bloom-button secondary" onClick={()=>setAvailableOnly(false)}>Show all jobs</button></p>}
    {search.get('city')&&user.role==='cleaner'&&search.get('city')!==user.approvedCityId&&<p role="status">Your approved city has changed. Showing your current approved city.</p>}
    {user.role === 'admin' && cities.loading ? <Loading /> : user.role === 'admin' && cities.error ? <ErrorNotice error={cities.error} retry={cities.reload} /> : !cityId ? <Empty title={user.role === 'admin' ? 'Select a city to browse cleanings' : 'Choose your city to find cleanings'}>{user.role === 'admin' ? 'The city filter changes only this view.' : 'Your first city selection is immediate. Later changes require admin approval.'}</Empty> : <><div className="loc-header"><div><h1 className="loc-name">{property ? properties.find(item => item.id === property)?.name ?? 'Selected property' : 'All properties'}</h1><p className="loc-meta cleaner-view-description">{view === 'calendar' ? user.role === 'admin' ? 'Admin view · Cleanings in the selected city' : 'Available cleanings in your approved city' : 'Your assigned cleanings in this month'} · Times are local to each property</p></div></div><MonthHead month={month} onDaySelect={setSelectedDay} onMonth={changeMonth} />{jobs.loading ? <Loading /> : jobs.error ? <ErrorNotice error={jobs.error} retry={jobs.reload} /> : view === 'calendar' ? <><CalendarGrid month={month} onDaySelect={setSelectedDay}>{date => visible.filter(job => job.checkoutDate === date).map(job => <div key={job.id}><button className={`day-pill${job.myAssignmentId ? ' mine' : job.activeCleanerCount < 2 && job.status === 'open' ? ' open' : ''}`} onClick={() => setSelectedDay(date)} aria-label={`${job.propertyName}, ${formatDate(date)}, ${job.activeCleanerCount} of 2 assigned, ${job.status}${job.reviewRequired ? ', needs admin attention' : ''}`}><span className="dp-plus">{job.myAssignmentId ? '✓' : job.activeCleanerCount < 2 ? <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg> : '2'}</span><span className="dp-label">{job.propertyName}</span></button>{(job.changes.length > 0 || job.reviewRequired) && <span className="bloom-block-notice">Booking changed</span>}</div>)}</CalendarGrid>{!visible.length && <Empty title="No cleanings this month">Try another month or property.</Empty>}</> : <div className="up-wrap">{dayFilter&&<p>Jobs for {formatDate(dayFilter)} <button className="bloom-button secondary" onClick={()=>setDayFilter(null)}>Show whole month</button></p>}<h2 className="up-heading">You have <span className="up-count">{upcoming.length}</span><br />upcoming {upcoming.length === 1 ? 'cleaning' : 'cleanings'}</h2><p className="up-subhead">In the selected month · {property ? 'This property' : 'Across your approved city'}</p><div className="up-list">{upcoming.map(job => <button className="up-card" key={job.id} onClick={() => setSelected(job)}><div className="up-date">{formatDate(job.checkoutDate)}</div><div className="up-avatars">{[0, 1].map(slot => <span className="open-circle bloom-slot" key={slot}>{slot === 0 ? 'You' : job.activeCleanerCount === 2 ? 'Assigned' : '+'}</span>)}</div><h3 className="up-title">{job.propertyName}</h3><div className="up-loc">{formatTime(job.startAt, job.timezone)}–{formatTime(job.endAt, job.timezone)} · {job.timezone}</div><div className="up-badge">You’re on it</div>{job.reviewRequired && <span className="bloom-block-notice">Booking changes need admin attention</span>}</button>)}</div>{!upcoming.length && <Empty title="No upcoming cleanings in this month">Browse the calendar to claim a slot.</Empty>}</div>}</>}
  </>}</div></main></div>{selectedDay&&!selected&&!jobs.loading&&!jobs.error&&<CleanerDayDialog date={selectedDay} jobs={jobs.error?[]:visible.filter(job=>job.checkoutDate===selectedDay)} onSelect={setSelected} onClose={()=>{const date=selectedDay;setSelectedDay(null);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(`button[data-calendar-date="${date}"]`)?.focus());}}/>}{selected && <JobDetail job={selected} user={user} integration={integration} onClose={() => setSelected(null)} onUpdate={job => { setSelected(job); jobs.reload(); }} refresh={jobs.reload} />}</>;
}

export function CleanerHub({ integration = noIntegration }: { integration?: BloomIntegration }) {
  return <div className="bloom-cleaner cleaner-hub app"><a className="bloom-skip" href="#bloom-main">Skip to content</a><RoleGate role="cleaner">{(user, refresh) => <CleanerContent user={user} refreshUser={refresh} integration={integration} />}</RoleGate></div>;
}
