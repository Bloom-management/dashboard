'use client';
import {BookingSourceCard} from './booking-source-card';
import {CalendarTypeToggle} from './calendar-add-flow';
import type {CalendarAddCleaning} from '../../contracts/calendar-add';
import {CleaningActivity} from './activity';
import {OwnerPayouts} from './owner-payouts';
import {useSearchParams} from 'next/navigation';
import {NotificationInbox} from '../push/inbox';

import {SelectorPill} from './selector-pill';
import {CalendarFilters,PhoneMonthSection,PhoneMonths,useIsPhone} from './cleaner-mobile-calendar';
import {DropdownMenu,DropdownMenuContent,DropdownMenuRadioGroup,DropdownMenuRadioItem,DropdownMenuTrigger} from '../ui/dropdown-menu';
import {ButtonContent} from './button-content';
import {navigationLabel} from './navigation-labels';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
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
import { Account, Brand, HubSelector, Changes, Empty, ErrorNotice, Loading, Modal, MonthHead, RoleGate, useResource, Icon} from './primitives';

const noIntegration: BloomIntegration = {};
type OwnerTab='calendar'|'performance'|'listings'|'people'|'payouts'|'activity';
const sources=[{id:'all',name:'All sources'},{id:'airbnb',name:'Airbnb'},{id:'vrbo',name:'VRBO'},{id:'external',name:'External'}];
const matchesSource=(block:OwnerCalendarBlock,source:string)=>source==='all'||(source==='external'?!block.providers.some(provider=>provider==='airbnb'||provider==='vrbo'):block.providers.some(provider=>provider===source));
/** One owner month on phones: its own bookings and cleanings, then the shared owner month grid. Only the month holding the selected day shows the day dialog. */
function OwnerPhoneMonth({month,scope,reloadToken,visibleIds,sourceFilter,calendarType,selectedDay,onDayChange,onSelect,onCreated,onCleanings}:{month:string;scope:string;reloadToken:number;visibleIds:string[];sourceFilter:string;calendarType:'cleanings'|'bookings';selectedDay:string|null;onDayChange:(day:string|null)=>void;onSelect:(block:OwnerCalendarBlock)=>void;onCreated:()=>void;onCleanings:(month:string,items:CalendarAddCleaning[])=>void}){
  const range=monthRange(month);
  const calendar=useCalendar<OwnerCalendarBlock[]>(scope,`/owner/calendar?from=${range.from}&to=${range.to}`);
  const cleanings=useResource(useCallback((signal:AbortSignal)=>request<CalendarAddCleaning[]>(`/calendar/add/cleanings?${new URLSearchParams({from:range.from,to:range.to})}`,{signal}),[range.from,range.to]),true);
  const reloadCalendar=calendar.reload,reloadCleanings=cleanings.reload,first=useRef(true);
  useEffect(()=>{if(first.current){first.current=false;return;}reloadCalendar();reloadCleanings();},[reloadToken,reloadCalendar,reloadCleanings]);
  useEffect(()=>{if(cleanings.data)onCleanings(month,cleanings.data);},[cleanings.data,month,onCleanings]);
  return <PhoneMonthSection month={month}>{calendar.error?<ErrorNotice error={calendar.error} retry={calendar.reload}/>:<OwnerMonth calendarType={calendarType} month={month} day={selectedDay?.startsWith(month)?selectedDay:null} onDayChange={onDayChange} onSelect={onSelect} onCreated={()=>{reloadCalendar();reloadCleanings();onCreated();}} initialPropertyId={visibleIds.length===1?visibleIds[0]:undefined} cleanings={(cleanings.data??[]).filter(job=>visibleIds.includes(job.propertyId))} blocks={(calendar.data??[]).filter(block=>visibleIds.includes(block.propertyId)&&matchesSource(block,sourceFilter))}/>}</PhoneMonthSection>;
}
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
  const phone=useIsPhone();
  const [filtersOpen,setFiltersOpen]=useState(false),[todayRequest,setTodayRequest]=useState(0),[reloadToken,setReloadToken]=useState(0);
  const [phoneCleanings,setPhoneCleanings]=useState<Record<string,CalendarAddCleaning[]>>({});
  const onPhoneCleanings=useCallback((key:string,items:CalendarAddCleaning[])=>setPhoneCleanings(previous=>previous[key]===items?previous:{...previous,[key]:items}),[]);
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
  const changed=()=>{setSelected(null);calendar.reload();calendarCleanings.reload();freshness.reload();propertyData.reload();setRevision(value=>value+1);setReloadToken(value=>value+1);};
  const pickTab=(view:OwnerTab)=>{setTab(view);setSelected(null);};
  const phoneCalendar=phone&&tab==='calendar';
  const loadedCleanings=Object.values(phoneCleanings).flat();
  const filterProperties=properties.map(item=>({id:item.id,name:item.name,count:loadedCleanings.filter(job=>job.propertyId===item.id).length}));
  const wallet=<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" style={{display:'block'}}><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M16 11h5v5h-5a2.5 2.5 0 0 1 0-5Z"/></svg>;
  const more=<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{display:'block'}}><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>;
  const phoneNav=<nav className="phone-view-nav" aria-label="Owner views"><SelectorPill aria-label="Owner views">{(['calendar','listings','payouts'] as const).map(view=><button type="button" key={view} className={`vt-btn${tab===view?' active':''}`} aria-current={tab===view?'page':undefined} onClick={()=>pickTab(view)}>{view==='payouts'?wallet:<Icon name={view==='calendar'?'grid':'house'}/>}<span>{navigationLabel(view)}</span></button>)}<DropdownMenu><DropdownMenuTrigger className={`vt-btn${tab==='performance'||tab==='people'||tab==='activity'?' active':''}`} aria-label="More views">{more}<span>{tab==='performance'||tab==='people'||tab==='activity'?navigationLabel(tab):'More'}</span></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuRadioGroup value={tab} onValueChange={value=>pickTab(value as OwnerTab)}>{(['performance','people','activity'] as const).map(view=><DropdownMenuRadioItem key={view} value={view}>{navigationLabel(view)}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu></SelectorPill></nav>;
  return <><header className="topbar bloom-compact-header"><Brand role="owner" />{phoneCalendar&&<div className="phone-toolbar"><CalendarTypeToggle value={calendarType} onChange={value=>{setCalendarType(value);setSelectedDay(null);}}/><div className="phone-cal-actions"><button type="button" className="bloom-button secondary" onClick={()=>setTodayRequest(value=>value+1)}>Today</button><button type="button" className="bloom-button secondary phone-filters-button" data-active={hidden.length>0||sourceFilter!=='all'||undefined} onClick={()=>setFiltersOpen(true)}><ButtonContent icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" style={{display:'block'}}><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>}>Filters</ButtonContent></button></div></div>}<div className="topbar-right"><HubSelector user={user} view="owner"/>{!phone&&<SelectorPill className="owner-desktop-views" aria-label="Owner views">{(['calendar','performance','listings','people','payouts','activity'] as const).map(view=><button type="button" key={view} className={`vt-btn${tab===view?' active':''}`} aria-current={tab===view?'page':undefined} onClick={()=>{setTab(view);setSelected(null);}}>{navigationLabel(view)}</button>)}</SelectorPill>}{!phone&&<MobileViewMenu label="Owner views" value={tab} values={['calendar','performance','listings','people','payouts','activity']} onChange={value=>{if(value==='activity'||value==='calendar'||value==='performance'||value==='listings'||value==='people'||value==='payouts'){setTab(value);setSelected(null);}}}/>}<NotificationInbox/><div className="bloom-header-account">{integration.accountControl?.(user) ?? <Account user={user} />}</div></div></header><div className="body"><main className={`main owner-main${tab==='listings'?' owner-listings-main':''}`} id="bloom-main"><div className="main-inner"><div className="loc-header"><div><h1 className="loc-name">{user.role==='admin'?'All properties':'Your properties'}</h1><p className="loc-meta">{user.role==='admin'?'Admin view · ':''}Stays, performance and supplies · Dates are local to each property</p></div><div className="owner-header-actions"><button className="bloom-button secondary" onClick={changed}>Refresh</button>{tab==='listings'&&<OwnerAddListingButton role={user.role} onClick={()=>setCreateOpen(true)}/>}</div></div>
    {propertyData.loading&&!propertyData.data&&!createdListings.length?<Loading/>:propertyData.error&&(!createdListings.length||listingAccessDenied)?<ErrorNotice error={propertyData.error} retry={propertyData.reload}/>:<>
    {!!propertyData.error&&<ErrorNotice error={propertyData.error} retry={propertyData.reload}/>}
    {tab!=='listings'&&tab!=='people'&&tab!=='payouts'&&tab!=='activity'&&!phoneCalendar&&<OwnerUnitFilter properties={properties} hidden={hidden} onChange={value=>{setHidden(value);setSelected(null);}}/>}
    {tab==='activity'?<CleaningActivity hub="owner"/>:tab==='payouts'?<OwnerPayouts/>:tab==='people'?<OwnerPeople listings={properties}/>:!properties.length?<Empty title="No properties linked yet"><p>Add your first property from the Listings tab to get started.</p></Empty>:<>
    <div hidden={tab!=='calendar'}>
    {phoneCalendar?<PhoneMonths anchor={month} todayRequest={todayRequest} renderMonth={item=><OwnerPhoneMonth month={item} scope={`${user.id}:${user.role}`} reloadToken={reloadToken} visibleIds={visibleProperties.map(property=>property.id)} sourceFilter={sourceFilter} calendarType={calendarType} selectedDay={selectedDay} onDayChange={setSelectedDay} onSelect={setSelected} onCreated={()=>{calendar.reload();calendarCleanings.reload();}} onCleanings={onPhoneCleanings}/>}/>:<>
    {freshness.loading?<Loading/>:freshness.error?<ErrorNotice error={freshness.error} retry={freshness.reload}/>:freshness.data&&<section aria-label="Property calendar sync status"><div className="owner-property-legend">{legendItems.slice(currentLegendPage*6,currentLegendPage*6+6).map(item=><span className="owner-property-key" key={item.propertyId} style={{'--property-color':ownerPropertyColor(item.propertyId)} as CSSProperties}><span className="owner-key-dot" aria-hidden="true"/><span>{properties.find(property=>property.id===item.propertyId)?.name??'Property'}<small>{item.message??(item.lastSuccessAt?`Last synced ${new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(item.lastSuccessAt))} UTC`:'Not synced yet')}</small></span></span>)}</div>{legendPages>1&&<div className="owner-legend-pagination"><button className="icon-btn" aria-label="Previous listings" disabled={currentLegendPage===0} onClick={()=>setLegendPage(currentLegendPage-1)}><Icon name="left"/></button><span aria-live="polite">{currentLegendPage+1} of {legendPages}</span><button className="icon-btn" aria-label="Next listings" disabled={currentLegendPage===legendPages-1} onClick={()=>setLegendPage(currentLegendPage+1)}><Icon name="right"/></button></div>}</section>}
    <LocationDropdown label="Calendar source" value={sourceFilter} onValueChange={value=>{setSourceFilter(value);setSelected(null);setSelectedDay(null);}} locations={[{id:'all',name:'All sources'},{id:'airbnb',name:'Airbnb'},{id:'vrbo',name:'VRBO'},{id:'external',name:'External'}]}/><MonthHead beforeToday={<CalendarTypeToggle value={calendarType} onChange={value=>{setCalendarType(value);setSelectedDay(null);}}/>} month={month} owner onDaySelect={setSelectedDay} onMonth={value=>{setSelected(null);setSelectedDay(null);setMonth(value);}}/><p className="legend">Stays · Blocked · Unconfirmed · Dates are local to each property</p>
    {!!calendarCleanings.error&&<ErrorNotice error={calendarCleanings.error} retry={calendarCleanings.reload}/>}
    {calendar.loading&&!calendar.data?<Loading/>:calendar.error?<ErrorNotice error={calendar.error} retry={calendar.reload}/>:visibleProperties.length?<OwnerMonth calendarType={calendarType} onViewDate={date=>{setMonth(date.slice(0,7));setSelectedDay(date);}} cleanings={(calendarCleanings.data??[]).filter(job=>visibleProperties.some(property=>property.id===job.propertyId))} initialPropertyId={visibleProperties.length===1?visibleProperties[0].id:undefined} onCreated={()=>{calendar.reload();calendarCleanings.reload();}} month={month} day={selectedDay} onDayChange={setSelectedDay} blocks={(calendar.data??[]).filter(block=>visibleProperties.some(property=>property.id===block.propertyId)&&(sourceFilter==='all'||(sourceFilter==='external'?!block.providers.some(provider=>provider==='airbnb'||provider==='vrbo'):block.providers.some(provider=>provider===sourceFilter))))} onSelect={setSelected}/>:<Empty title="No units selected">Check a unit above to show its timeline.</Empty>}
    </>}
    </div>
    {tab==='performance'&&<OwnerPerformancePanel propertyIds={visibleProperties.map(item=>item.id)} from={range.from} toExclusive={toExclusive} revision={revision} lastUpdatedAt={visibleProperties.length&&visibleProperties.every(p=>p.sources.length>0&&p.sources.every(s=>s.lastSuccessAt))?visibleProperties.flatMap(p=>p.sources.map(s=>s.lastSuccessAt!)).sort()[0]:null}/>}
    {tab==='listings'&&<OwnerListings key={(query.get('property')??'')+':'+(query.get('section')??'')} initialSelectedId={query.get('property')??undefined} admin={user.role==='admin'} listings={properties} integration={integration} onChanged={changed} from={range.from} toExclusive={toExclusive} revision={revision}/>}
    </>}
    </>}
  </div></main></div>{phone&&phoneNav}{phone&&<CalendarFilters open={filtersOpen} onOpenChange={setFiltersOpen} countLabel={['cleaning','cleanings']} properties={filterProperties} selected={hidden.length?properties.filter(item=>!hidden.includes(item.id)).map(item=>item.id):null} onApply={value=>{setHidden(value?properties.filter(item=>!value.includes(item.id)).map(item=>item.id):[]);setSelected(null);}}><h3 className="calendar-filter-heading">Calendar source</h3><div className="calendar-filter-sources" role="radiogroup" aria-label="Calendar source">{sources.map(source=><button type="button" role="radio" key={source.id} aria-checked={sourceFilter===source.id} onClick={()=>{setSourceFilter(source.id);setSelectedDay(null);}}>{source.name}</button>)}</div></CalendarFilters>}{user.role==='owner'&&<OwnerCreateListing open={createOpen} listings={properties} onClose={()=>setCreateOpen(false)} onCreated={listing=>{window.dispatchEvent(new Event('bloom:listings-changed'));setCreatedListings(previous=>[...previous.filter(item=>item.id!==listing.id),listing]);setHidden(properties.filter(property=>property.id!==listing.id).map(property=>property.id));setTab('listings');changed();}} onChanged={changed}/>} {selected && <Modal className="bk-card" title={`${selected.propertyName} ${label(selected)}`} onClose={() => setSelected(null)}><div className="bk-body"><div className="bk-guest"><span className="bk-guest-label">{label(selected)}</span><h2 className="bk-guest-name">{selected.propertyName}</h2></div><BookingSourceCard providers={selected.providers}/><div className="bk-stay"><div className="bk-stay-end"><span className="bk-stay-cap">{selected.kind === 'reservation' ? 'Arrival' : 'Start'}</span><span className="bk-stay-date">{formatDate(selected.startDate)}</span></div><div className="bk-stay-line" /><div className="bk-stay-end"><span className="bk-stay-cap">{selected.kind === 'reservation' ? 'Checkout' : 'End · exclusive'}</span><span className="bk-stay-date">{formatDate(selected.endDate)}</span></div></div><p className="bk-foot-note">{selected.timezone}</p>{selected.removed && <p className="bloom-notice">{selected.providers.includes('manual')?'This manual booking was canceled and remains visible for reference.':'This block was removed from its source calendar and remains visible for reference.'}</p>}<Changes changes={selected.changes} /></div></Modal>}</>;
}
export function OwnerHub({ integration = noIntegration }: { integration?: BloomIntegration }) {
  return <div className="bloom-owner app"><a className="bloom-skip" href="#bloom-main">Skip to content</a><RoleGate role="owner">{user => <OwnerContent key={user.id} user={user} integration={integration} />}</RoleGate></div>;
}
