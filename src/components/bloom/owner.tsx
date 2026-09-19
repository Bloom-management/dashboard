'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { OwnerCalendarBlock, Provider, SessionUser } from '../../contracts';
import { useCalendar } from './use-calendar';
import { ApiError, request } from './api';
import type { OwnerListing, OwnerListingsPage } from '../../contracts/owner-hub';
import { OwnerUnitFilter } from './owner-unit-filter';
import { ownerPropertyColor } from './owner-colors';
import { OwnerMonth } from './owner-month';
import { OwnerPerformancePanel } from './owner-performance';
import { OwnerPeople } from './property-people';
import { OwnerListings } from './owner-listings';
import { OwnerAddListingButton, OwnerCreateListing } from './owner-create';
import { mergeCreatedListings, unconfirmedCreatedListings } from './owner-create-input';
import { formatDate, monthRange, shiftMonth, todayIn } from './dates';
import type { BloomIntegration } from './integration';
import { Account, Brand, HubSelector, Changes, Empty, ErrorNotice, Loading, Modal, MonthHead, RoleGate, useResource } from './primitives';

const noIntegration: BloomIntegration = {};
// Channel colors copied from the supplied owner-data.js; no booking/sample data imported.
const channels = {
  airbnb: { name: 'Airbnb', color: '#d35a4d', soft: '#f6ddd8', deep: '#a8453b', mono: 'A' },
  vrbo: { name: 'VRBO', color: '#2f8fae', soft: '#d7ebf2', deep: '#236f88', mono: 'V' },
};
function channelStyle(provider?: Provider): CSSProperties {
  const channel = provider ? channels[provider] : { color: '#7a7050', soft: '#efebe1', deep: '#4a4538' };
  return { '--ch': channel.color, '--ch-soft': channel.soft, '--ch-deep': channel.deep } as CSSProperties;
}
function label(block: OwnerCalendarBlock) {
  return block.removed ? 'Removed booking block' : block.kind === 'reservation' ? 'Reservation' : block.kind === 'blocked' ? 'Blocked period' : 'Unconfirmed period';
}
function OwnerContent({ user, integration }: { user: SessionUser; integration: BloomIntegration }) {
  const [month, setMonth] = useState(() => todayIn('America/Detroit').slice(0, 7));
  const [tab,setTab]=useState<'calendar'|'performance'|'listings'|'people'>('calendar');
  const [hidden,setHidden]=useState<string[]>([]);
  const [revision,setRevision]=useState(0);
  const [createOpen,setCreateOpen]=useState(false);
  const [createdListings,setCreatedListings]=useState<OwnerListing[]>([]);
  const [selected, setSelected] = useState<OwnerCalendarBlock | null>(null);
  const range = monthRange(month);
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
  const toExclusive=`${shiftMonth(month,1)}-01`;
  const changed=()=>{setSelected(null);calendar.reload();freshness.reload();propertyData.reload();setRevision(value=>value+1);};
  return <><header className="topbar"><Brand role="owner" /><div className="topbar-right"><HubSelector user={user} view="owner"/><nav className="view-toggle" aria-label="Owner views">{(['calendar','performance','listings','people'] as const).map(view=><button type="button" key={view} className={`vt-btn${tab===view?' active':''}`} aria-current={tab===view?'page':undefined} onClick={()=>{setTab(view);setSelected(null);}}>{view[0].toUpperCase()+view.slice(1)}</button>)}</nav>{integration.accountControl?.(user) ?? <Account user={user} />}</div></header><div className="body"><main className={`main owner-main${tab==='listings'?' owner-listings-main':''}`} id="bloom-main"><div className="main-inner"><div className="loc-header"><div><h1 className="loc-name">{user.role==='admin'?'All properties':'Your properties'}</h1><p className="loc-meta">{user.role==='admin'?'Admin view · ':''}Stays, performance and supplies · Dates are local to each property</p></div><div className="owner-header-actions"><button className="bloom-button secondary" onClick={changed}>Refresh</button>{tab==='listings'&&<OwnerAddListingButton role={user.role} onClick={()=>setCreateOpen(true)}/>}</div></div>
    {propertyData.loading&&!propertyData.data&&!createdListings.length?<Loading/>:propertyData.error&&(!createdListings.length||listingAccessDenied)?<ErrorNotice error={propertyData.error} retry={propertyData.reload}/>:<>
    {!!propertyData.error&&<ErrorNotice error={propertyData.error} retry={propertyData.reload}/>}
    {tab!=='listings'&&tab!=='people'&&<OwnerUnitFilter properties={properties} hidden={hidden} onChange={value=>{setHidden(value);setSelected(null);}}/>}
    {tab==='people'?<OwnerPeople listings={properties}/>:!properties.length?<Empty title="No properties linked yet"><p>Add your first property from the Listings tab to get started.</p></Empty>:<>
    <div hidden={tab!=='calendar'}>
    {freshness.loading?<Loading/>:freshness.error?<ErrorNotice error={freshness.error} retry={freshness.reload}/>:freshness.data&&<div className="owner-property-legend" aria-label="Property calendar sync status">{freshness.data.filter(item=>visibleProperties.some(property=>property.id===item.propertyId)).map(item=><span className="owner-property-key" key={item.propertyId} style={{'--property-color':ownerPropertyColor(item.propertyId)} as CSSProperties}><span className="owner-key-dot" aria-hidden="true"/><span>{properties.find(property=>property.id===item.propertyId)?.name??'Property'}<small>{item.message??(item.lastSuccessAt?`Last synced ${new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(item.lastSuccessAt))} UTC`:'Not synced yet')}</small></span></span>)}</div>}
    <MonthHead month={month} owner onMonth={value=>{setSelected(null);setMonth(value);}}/><p className="legend">Stays · Blocked · Unconfirmed · Dates are local to each property</p>
    {calendar.loading?<Loading/>:calendar.error?<ErrorNotice error={calendar.error} retry={calendar.reload}/>:visibleProperties.length?<OwnerMonth month={month} blocks={(calendar.data??[]).filter(block=>visibleProperties.some(property=>property.id===block.propertyId))} onSelect={setSelected}/>:<Empty title="No units selected">Check a unit above to show its timeline.</Empty>}
    </div>
    {tab==='performance'&&<OwnerPerformancePanel propertyIds={visibleProperties.map(item=>item.id)} from={range.from} toExclusive={toExclusive} revision={revision} lastUpdatedAt={visibleProperties.length&&visibleProperties.every(p=>p.sources.length>0&&p.sources.every(s=>s.lastSuccessAt))?visibleProperties.flatMap(p=>p.sources.map(s=>s.lastSuccessAt!)).sort()[0]:null}/>}
    {tab==='listings'&&<OwnerListings listings={properties} integration={integration} onChanged={changed} from={range.from} toExclusive={toExclusive} revision={revision}/>}
    </>}
    </>}
  </div></main></div>{user.role==='owner'&&<OwnerCreateListing open={createOpen} listings={properties} onClose={()=>setCreateOpen(false)} onCreated={listing=>{setCreatedListings(previous=>[...previous.filter(item=>item.id!==listing.id),listing]);setHidden(properties.filter(property=>property.id!==listing.id).map(property=>property.id));setTab('listings');changed();}} onChanged={changed}/>} {selected && <Modal className="bk-card" title={`${selected.propertyName} ${label(selected)}`} onClose={() => setSelected(null)}><div className="bk-banner" style={channelStyle(selected.providers[0])}><div className="bk-banner-txt"><span className="bk-via">Calendar feed: {selected.providers.map(provider => channels[provider].name).join(' · ') || 'Platform unavailable'}</span><span className="bk-readonly">Synced calendar · read-only</span></div></div><div className="bk-body"><div className="bk-guest"><span className="bk-guest-label">{label(selected)}</span><h2 className="bk-guest-name">{selected.propertyName}</h2></div><div className="bk-stay"><div className="bk-stay-end"><span className="bk-stay-cap">{selected.kind === 'reservation' ? 'Arrival' : 'Start'}</span><span className="bk-stay-date">{formatDate(selected.startDate)}</span></div><div className="bk-stay-line" /><div className="bk-stay-end"><span className="bk-stay-cap">{selected.kind === 'reservation' ? 'Checkout' : 'End · exclusive'}</span><span className="bk-stay-date">{formatDate(selected.endDate)}</span></div></div><p className="bk-foot-note">{selected.timezone}</p>{selected.removed && <p className="bloom-notice">This block was removed from its source calendar and remains visible for reference.</p>}<Changes changes={selected.changes} /></div></Modal>}</>;
}
export function OwnerHub({ integration = noIntegration }: { integration?: BloomIntegration }) {
  return <div className="bloom-owner app"><a className="bloom-skip" href="#bloom-main">Skip to content</a><RoleGate role="owner">{user => <OwnerContent key={user.id} user={user} integration={integration} />}</RoleGate></div>;
}
