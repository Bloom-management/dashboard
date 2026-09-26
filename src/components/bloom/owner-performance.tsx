'use client';
import { PieChart, Pie, Cell, Label, Tooltip, ResponsiveContainer } from 'recharts';
import { useCallback, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { Calendar, calendarDate, calendarValue } from '../ui/calendar';
import { formatDate } from './dates';
import type { OwnerMetricTotals, OwnerPerformance } from '../../contracts/owner-hub';
import { request } from './api';
import { Empty, ErrorNotice, Icon, Loading, useResource } from './primitives';
import { occupancyLabel, ownerRangeValid } from './owner-utils';

export function OwnerPlatformShare({totals}:{totals:OwnerMetricTotals}) {
 const colors=[{fill:'#edcbd3',stroke:'#b85563'},{fill:'#cdd9e7',stroke:'#577b9f'},{fill:'#e0dfcd',stroke:'#93926a'}];
 const data=totals.platformShare.map((item,index)=>({...item,name:item.platform==='airbnb'?'Airbnb':item.platform==='vrbo'?'Vrbo':'Blocked / unattributed',...colors[index%colors.length]}));
 const total=data.reduce((sum,item)=>sum+item.nights,0);
 return <section aria-label="Share of known occupied nights"><h4>Share of known occupied nights</h4><div className="owner-share-chart"><div className="owner-share-donut" role="img" aria-label={`${total} known occupied nights. Platform breakdown in legend.`}>{total>0?<ResponsiveContainer width="100%" height="100%"><PieChart><Tooltip contentStyle={{background:'#fff',border:'1px solid #e7e2da',borderRadius:14,fontFamily:'inherit'}}/><Pie data={data} dataKey="nights" nameKey="name" innerRadius="62%" outerRadius="88%" strokeWidth={2} isAnimationActive={false}>{data.map(item=><Cell key={item.platform} fill={item.fill} stroke={item.stroke}/>)}<Label position="center" content={({viewBox})=>viewBox&&'cx' in viewBox?<text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" fill="#2d2a1f"><tspan x={viewBox.cx} dy="-2" fontSize="28" fontWeight="600">{total.toLocaleString()}</tspan><tspan x={viewBox.cx} dy="23" fontSize="12">Known nights</tspan></text>:null}/></Pie></PieChart></ResponsiveContainer>:<div className="owner-share-empty">0<span>No known occupied nights</span></div>}</div><ul className="owner-share-legend">{data.map(item=><li key={item.platform}><span className="owner-share-swatch" style={{background:item.fill,borderColor:item.stroke}}/><span><strong>{item.name}</strong><span>{item.nights} nights · {item.share===null?'N/A':occupancyLabel(item.share)}</span></span></li>)}</ul></div><p>Blocked / unattributed includes unavailable nights and stays without confirmed booking origin. An Airbnb or VRBO calendar feed does not prove where a booking originated. This is not a measure of complete calendar coverage.</p></section>;
}
export function OwnerTotals({totals}:{totals:OwnerMetricTotals}){
 const incomplete=totals.coverage.status!=='complete';
 return <><div className="owner-metrics">{[
  ['Occupancy including blocked nights',incomplete?'N/A':occupancyLabel(totals.occupancy)],['Known booked nights',totals.bookedNights],['Known blocked nights',totals.blockedNights],['Unbooked nights',incomplete?'N/A':totals.unbookedNights??'N/A'],['Known check-ins',totals.checkIns]
 ].map(([label,value])=><div className="owner-metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
 <p className="bloom-notice">Coverage: {totals.coverage.status}. {totals.coverage.message} {totals.coverage.eligibleUnitNights} of {totals.coverage.totalUnitNights} unit-nights have authoritative coverage.</p>
 {incomplete&&<p>These are known observations, not a complete availability calendar. Occupancy and unbooked nights remain unavailable until coverage is complete.</p>}
 <OwnerPlatformShare totals={totals}/>
 </>;
}
export function OwnerPerformancePanel({propertyIds,from,toExclusive,revision,lastUpdatedAt}:{propertyIds:string[];from:string;toExclusive:string;revision:number;lastUpdatedAt:string|null}){
 const [draft,setDraft]=useState<DateRange|undefined>({from:calendarDate(from),to:calendarDate(toExclusive)});const [range,setRange]=useState({from,toExclusive});
 const [mobileSide,setMobileSide]=useState<'start'|'end'>('start');
 const [leftMonth,setLeftMonth]=useState(calendarDate(from));
 const [rightMonth,setRightMonth]=useState(calendarDate(toExclusive));
 const key=JSON.stringify([...propertyIds].sort());
 const load=useCallback((signal:AbortSignal)=>{
  const ids=JSON.parse(key) as string[];if(!ids.length)return Promise.resolve(null);
  const query=new URLSearchParams({from:range.from,toExclusive:range.toExclusive});ids.forEach(id=>query.append('propertyId',id));
  return request<OwnerPerformance>(`/owner/performance?${query}`,{signal});
 // revision invalidates real metrics after source changes without changing identity or query.
 },[key,range.from,range.toExclusive,revision]);
 const resource=useResource(load);
 return <section aria-label="Property performance"><h2>Performance</h2><p>Source last updated: {lastUpdatedAt?`${new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(lastUpdatedAt))} UTC (oldest selected source)`:'N/A — not all selected sources have synced'}</p><form className="owner-range bloom-form" onSubmit={event=>{event.preventDefault();if(draft?.from&&draft.to&&ownerRangeValid(calendarValue(draft.from),calendarValue(draft.to),1830))setRange({from:calendarValue(draft.from),toExclusive:calendarValue(draft.to)});}}><div className="owner-performance-range"><div className="owner-range-picker"><div className="owner-range-toggle" role="group" aria-label="Range calendar side">{(['start','end'] as const).map(side=><button type="button" key={side} aria-pressed={mobileSide===side} onClick={()=>setMobileSide(side)}>{side==='start'?'Start':'End'}</button>)}</div><div className={`owner-independent-range owner-range-${mobileSide}`}><Calendar className="owner-range-start-panel" mode="range" captionLayout="dropdown" month={leftMonth} onMonthChange={setLeftMonth} selected={draft} onSelect={setDraft} min={1} max={1830} aria-label="Range start calendar"/><Calendar className="owner-range-end-panel" mode="range" captionLayout="dropdown" month={rightMonth} onMonthChange={setRightMonth} selected={draft} onSelect={setDraft} min={1} max={1830} aria-label="Range end calendar"/></div></div><div className="owner-range-summary" aria-live="polite"><p><strong>From:</strong> {draft?.from?formatDate(calendarValue(draft.from)):'Select a start date'}</p><p><strong>Until (exclusive):</strong> {draft?.to?formatDate(calendarValue(draft.to)):'Select an end date'}</p><p>Choose a range of up to five years. The end date is excluded from performance totals.</p><div className="bloom-actions"><button type="button" className="bloom-button secondary" disabled={!draft?.from&&!draft?.to} onClick={()=>setDraft(undefined)}>Clear dates</button><button className="bloom-button" disabled={!draft?.from||!draft.to||!ownerRangeValid(calendarValue(draft.from),calendarValue(draft.to),1830)}>Apply dates</button></div></div></div></form>
 {!propertyIds.length?<Empty title="No units selected">Select a unit to see performance.</Empty>:resource.loading?<Loading/>:resource.error?<ErrorNotice error={resource.error} retry={resource.reload}/>:resource.data&&<OwnerPerformanceCarousel key={key} data={resource.data}/>}
 </section>;
}

function OwnerPerformanceCarousel({data}:{data:OwnerPerformance}) {
 const [activeId,setActiveId]=useState<string|null>(null);
 const slides=[{id:null,name:'Selected portfolio',totals:data.totals},...data.properties.map(property=>({id:property.propertyId,name:property.propertyName,totals:property}))];
 const index=Math.max(0,slides.findIndex(slide=>slide.id===activeId));
 const active=slides[index];
 function move(offset:number){setActiveId(slides[(index+offset+slides.length)%slides.length].id);}
 return <section className="owner-performance-carousel" role="region" aria-roledescription="carousel" aria-label="Portfolio and property performance" tabIndex={0} onKeyDown={event=>{if(event.target!==event.currentTarget)return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();move(event.key==='ArrowLeft'?-1:1);}}}>
 <div className="owner-carousel-heading"><h3 aria-live="polite">{active.name}</h3><div className="owner-carousel-controls"><span aria-live="polite">{index+1} / {slides.length}</span><button type="button" className="icon-btn" aria-label="Previous property performance" disabled={slides.length<2} onClick={()=>move(-1)}><Icon name="left"/></button><button type="button" className="icon-btn" aria-label="Next property performance" disabled={slides.length<2} onClick={()=>move(1)}><Icon name="right"/></button></div></div>
 <div role="group" aria-roledescription="slide" aria-label={`${active.name}, ${index+1} of ${slides.length}`}><OwnerTotals totals={active.totals}/></div>
 <p>Blocked nights count as occupied, assuming they represent off-platform bookings.</p><p>{data.assumption}</p><p>Platform attribution uses booking-origin evidence. A calendar's provider alone does not establish where a guest booked. Cross-feed booking identities may remain unresolved.</p>
 </section>;
}
