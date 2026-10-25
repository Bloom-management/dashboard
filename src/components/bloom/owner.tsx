'use client';
import {BookingSourceCard} from './booking-source-card';
import {CalendarTypeToggle} from './calendar-add-flow';
import type {CalendarAddCleaning} from '../../contracts/calendar-add';
import {CleaningActivity} from './activity';
import {OwnerPayouts} from './owner-payouts';
import {useSearchParams} from 'next/navigation';
import {NotificationInbox} from '../push/inbox';

import {SelectorPill} from './selector-pill';
import {navigationLabel} from './navigation-labels';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { OwnerCalendarBlock, SessionUser } from '../../contracts';
import { useCalendar } from './use-calendar';
import { ApiError, request } from './api';
import type { OwnerListing, OwnerListingsPage } from '../../contracts/owner-hub';
import {LocationDropdown} from './location-dropdown';
import { OwnerUnitFilter } from './owner-unit-filter';
import { ownerPropertyColor } from './owner-colors';
import { OwnerMonth } from './owner-month';
import { OwnerPerformancePanel } from './owner-performance';
import {MobileViewMenu} from './mobile-view-menu';
import { OwnerPeople } from './property-people';
import { OwnerListings } from './owner-listings';
import { OwnerAddListingButton, OwnerCreateListing } from './owner-create';
import { mergeCreatedListings, unconfirmedCreatedListings } from './owner-create-input';
import { formatDate, monthRange, shiftMonth, todayIn } from './dates';
import type { BloomIntegration } from './integration';
import { Account, Brand, HubSelector, Changes, Empty, ErrorNotice, Loading, Modal, MonthHead, RoleGate, useResource } from './primitives';

const noIntegration: BloomIntegration = {};
function label(block: OwnerCalendarBlock) {
  if(block.label)return block.label;
  return block.removed ? 'Removed booking block' : block.kind === 'reservation' ? 'Reservation' : block.kind === 'blocked' ? 'Blocked period' : 'Unconfirmed period';
}
function OwnerContent({ user, integration }: { user: SessionUser; integration: BloomIntegration }) {
  const [calendarType,setCalendarType]=useState<'cleanings'|'bookings'>('cleanings');
  const [month, setMonth] = useState(() => todayIn('America/Detroit').slice(0, 7));
  const query=useSearchParams();
  const [tab,setTab]=useState<'calendar'|'performance'|'listings'|'people'|'payouts'|'activity'>(()=>{const view=query.get('view');return view==='activity'||view==='listings'||view==='people'||view==='payouts'||view==='performance'?view:'calendar';});
  useEffect(()=>{const view=query.get('view');if(view==='activity'||view==='listings'||view==='people'||view==='payouts'||view==='performance')setTab(view);},[query]);
  const [legendPage,setLegendPage]=useState(0);
  const [hidden,setHidden]=useState<string[]>([]);
  const [revision,setRevision]=useState(0);
  const [createOpen,setCreateOpen]=useState(user.role==='owner'&&query.get('create')==='1');
  useEffect(()=>{const show=()=>{if(user.role==='owner'){setTab('listings');setCreateOpen(true);}};window.addEventListener('bloom:add-listing',show);return()=>window.removeEventListener('bloom:add-listing',show);},[user.role]);
  const [createdListings,setCreatedListings]=useState<OwnerListing[]>([]);
  const [selectedDay,setSelectedDay]=useState<string|null>(null);
  const [selected, setSelected] = useState<OwnerCalendarBlock | null>(null);
  const [sourceFilter,setSourceFilter]=useState('all');
  const range = monthRange(month);
  const calendarCleanings=useResource(useCallback((signal:AbortSignal)=>request<CalendarAddCleaning[]>(`/calendar/add/cleanings?${new URLSearchParams({from:range.from,to:range.to})}`,{signal}),[range.from,range.to]),true);
  const calendar = useCalendar<OwnerCalendarBlock[]>(`${user.id}:${user.role}`, `/owner/calendar?from=${range.from}&to=${range.to}`);
  useEffect(() => {
    if (calendar.error) setSelected(null);
    else if (calendar.data) setSelected(current => current ? calendar.data!.find(block => block.id === current.id) ?? null : null);
  }, [calendar.data, calendar.error]);
  const propertyLoad = useCallback(async(signal:AbortSignal)=>{
    const rows:OwnerListing[]=[];const seen=new Set<string>();let cursor:string|null=null;
    do{const page:OwnerListingsPage=await request<OwnerListingsPage>(`/owner/listings${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,{signal});rows.push(...page.items);cursor=page.nextCursor;if(cursor){if(seen.has(cursor))throw new Error('Listing pagination could not advance');seen.add(cursor);}}while(cursor);
    return rows;
  },[]);
  const propertyData = useResource(propertyLoad,true);
  const listingAccessDenied=propertyData.error instanceof ApiError&&['FORBIDDEN','UNAUTHENTICATED'].includes(propertyData.error.code);
  useEffect(()=>{
    if(listingAccessDenied)setCreatedListings([]);
    else if(propertyData.data)setCreatedListings(previous=>unconfirmedCreatedListings(propertyData.data!,previous));
  },[propertyData.data,listingAccessDenied]);
  const freshLoad = useCallback((signal: AbortSignal) => integration.ownerFreshness ? integration.ownerFreshness(signal) : Promise.resolve(null), [integration]);
  const freshness = useResource(freshLoad);
  const serverListings=propertyData.data??[];
  const properties = mergeCreatedListings(serverListings,createdListings);
  const visibleProperties=properties.filter(item=>!hidden.includes(item.id));
  const legendItems=freshness.data?.filter(item=>visibleProperties.some(property=>property.id===item.propertyId))??[];
  const legendPages=Math.max(1,Math.ceil(legendItems.length/6));
  const currentLegendPage=Math.min(legendPage,legendPages-1);
  const toExclusive=`${shiftMonth(month,1)}-01`;
  const changed=()=>{setSelected(null);calendar.reload();calendarCleanings.reload();freshness.reload();propertyData.reload();setRevision(value=>value+1);};
  return <><header className="topbar bloom-compact-header"><Brand role="owner" /><div className="topbar-right"><HubSelector user={user} view="owner"/><SelectorPill className="owner-desktop-views" aria-label="Owner views">{(['calendar','performance','listings','people','payouts','activity'] as const).map(view=><button type="button" key={view} className={`vt-btn${tab===view?' active':''}`} aria-current={tab===view?'page':undefined} onClick={()=>{setTab(view);setSelected(null);}}>{navigationLabel(view)}</button>)}</SelectorPill><MobileViewMenu label="Owner views" value={tab} values={['calendar','performance','listings','people','payouts','activity']} onChange={value=>{if(value==='activity'||value==='calendar'||value==='performance'||value==='listings'||value==='people'||value==='payouts'){setTab(value);setSelected(null);}}}/><NotificationInbox/><div className="bloom-header-account">{integration.accountControl?.(user) ?? <Account user={user} />}</div></div></header><div className="body"><main className={`main owner-main${tab==='listings'?' owner-listings-main':''}`} id="bloom-main"><div className="main-inner"><div className="loc-header"><div><h1 className="loc-name">{user.role==='admin'?'All properties':'Your properties'}</h1><p className="loc-meta">{user.role==='admin'?'Admin view · ':''}Stays, performance and supplies · Dates are local to each property</p></div><div className="owner-header-actions"><button className="bloom-button secondary" onClick={changed}>Refresh</button>{tab==='listings'&&<OwnerAddListingButton role={user.role} onClick={()=>setCreateOpen(true)}/>}</div></div>
    {propertyData.loading&&!propertyData.data&&!createdListings.length?<Loading/>:propertyData.error&&(!createdListings.length||listingAccessDenied)?<ErrorNotice error={propertyData.error} retry={propertyData.reload}/>:<>
    {!!propertyData.error&&<ErrorNotice error={propertyData.error} retry={propertyData.reload}/>}
    {tab!=='listings'&&tab!=='people'&&tab!=='payouts'&&tab!=='activity'&&<OwnerUnitFilter properties={properties} hidden={hidden} onChange={value=>{setHidden(value);setSelected(null);}}/>}
    {tab==='activity'?<CleaningActivity hub="owner"/>:tab==='payouts'?<OwnerPayouts/>:tab==='people'?<OwnerPeople listings={properties}/>:!properties.length?<Empty title="No properties linked yet"><p>Add your first property from the Listings tab to get started.</p></Empty>:<>
    <div hidden={tab!=='calendar'}>
    {freshness.loading?<Loading/>:freshness.error?<ErrorNotice error={freshness.error} retry={freshness.reload}/>:freshness.data&&<section aria-label="Property calendar sync status"><div className="owner-property-legend">{legendItems.slice(currentLegendPage*6,currentLegendPage*6+6).map(item=><span className="owner-property-key" key={item.propertyId} style={{'--property-color':ownerPropertyColor(item.propertyId)} as CSSProperties}><span className="owner-key-dot" aria-hidden="true"/><span>{properties.find(property=>property.id===item.propertyId)?.name??'Property'}<small>{item.message??(item.lastSuccessAt?`Last synced ${new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(item.lastSuccessAt))} UTC`:'Not synced yet')}</small></span></span>)}</div>{legendPages>1&&<div className="owner-legend-pagination"><button className="icon-btn" aria-label="Previous listings" disabled={currentLegendPage===0} onClick={()=>setLegendPage(currentLegendPage-1)}>‹</button><span aria-live="polite">{currentLegendPage+1} of {legendPages}</span><button className="icon-btn" aria-label="Next listings" disabled={currentLegendPage===legendPages-1} onClick={()=>setLegendPage(currentLegendPage+1)}>›</button></div>}</section>}
    <LocationDropdown label="Calendar source" value={sourceFilter} onValueChange={value=>{setSourceFilter(value);setSelected(null);setSelectedDay(null);}} locations={[{id:'all',name:'All sources'},{id:'airbnb',name:'Airbnb'},{id:'vrbo',name:'VRBO'},{id:'external',name:'External'}]}/><MonthHead beforeToday={<CalendarTypeToggle value={calendarType} onChange={value=>{setCalendarType(value);setSelectedDay(null);}}/>} month={month} owner onDaySelect={setSelectedDay} onMonth={value=>{setSelected(null);setSelectedDay(null);setMonth(value);}}/><p className="legend">Stays · Blocked · Unconfirmed · Dates are local to each property</p>
    {!!calendarCleanings.error&&<ErrorNotice error={calendarCleanings.error} retry={calendarCleanings.reload}/>}
    {calendar.loading&&!calendar.data?<Loading/>:calendar.error?<ErrorNotice error={calendar.error} retry={calendar.reload}/>:visibleProperties.length?<OwnerMonth calendarType={calendarType} onViewDate={date=>{setMonth(date.slice(0,7));setSelectedDay(date);}} cleanings={(calendarCleanings.data??[]).filter(job=>visibleProperties.some(property=>property.id===job.propertyId))} initialPropertyId={visibleProperties.length===1?visibleProperties[0].id:undefined} onCreated={()=>{calendar.reload();calendarCleanings.reload();}} month={month} day={selectedDay} onDayChange={setSelectedDay} blocks={(calendar.data??[]).filter(block=>visibleProperties.some(property=>property.id===block.propertyId)&&(sourceFilter==='all'||(sourceFilter==='external'?!block.providers.some(provider=>provider==='airbnb'||provider==='vrbo'):block.providers.some(provider=>provider===sourceFilter))))} onSelect={setSelected}/>:<Empty title="No units selected">Check a unit above to show its timeline.</Empty>}
    </div>
    {tab==='performance'&&<OwnerPerformancePanel propertyIds={visibleProperties.map(item=>item.id)} from={range.from} toExclusive={toExclusive} revision={revision} lastUpdatedAt={visibleProperties.length&&visibleProperties.every(p=>p.sources.length>0&&p.sources.every(s=>s.lastSuccessAt))?visibleProperties.flatMap(p=>p.sources.map(s=>s.lastSuccessAt!)).sort()[0]:null}/>}
    {tab==='listings'&&<OwnerListings key={(query.get('property')??'')+':'+(query.get('section')??'')} initialSelectedId={query.get('property')??undefined} admin={user.role==='admin'} listings={properties} integration={integration} onChanged={changed} from={range.from} toExclusive={toExclusive} revision={revision}/>}
    </>}
    </>}
  </div></main></div>{user.role==='owner'&&<OwnerCreateListing open={createOpen} listings={properties} onClose={()=>setCreateOpen(false)} onCreated={listing=>{window.dispatchEvent(new Event('bloom:listings-changed'));setCreatedListings(previous=>[...previous.filter(item=>item.id!==listing.id),listing]);setHidden(properties.filter(property=>property.id!==listing.id).map(property=>property.id));setTab('listings');changed();}} onChanged={changed}/>} {selected && <Modal className="bk-card" title={`${selected.propertyName} ${label(selected)}`} onClose={() => setSelected(null)}><div className="bk-body"><div className="bk-guest"><span className="bk-guest-label">{label(selected)}</span><h2 className="bk-guest-name">{selected.propertyName}</h2></div><BookingSourceCard providers={selected.providers}/><div className="bk-stay"><div className="bk-stay-end"><span className="bk-stay-cap">{selected.kind === 'reservation' ? 'Arrival' : 'Start'}</span><span className="bk-stay-date">{formatDate(selected.startDate)}</span></div><div className="bk-stay-line" /><div className="bk-stay-end"><span className="bk-stay-cap">{selected.kind === 'reservation' ? 'Checkout' : 'End · exclusive'}</span><span className="bk-stay-date">{formatDate(selected.endDate)}</span></div></div><p className="bk-foot-note">{selected.timezone}</p>{selected.removed && <p className="bloom-notice">{selected.providers.includes('manual')?'This manual booking was canceled and remains visible for reference.':'This block was removed from its source calendar and remains visible for reference.'}</p>}<Changes changes={selected.changes} /></div></Modal>}</>;
}
export function OwnerHub({ integration = noIntegration }: { integration?: BloomIntegration }) {
  return <div className="bloom-owner app"><a className="bloom-skip" href="#bloom-main">Skip to content</a><RoleGate role="owner">{user => <OwnerContent key={user.id} user={user} integration={integration} />}</RoleGate></div>;
}
