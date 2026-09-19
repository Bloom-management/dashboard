import type { CSSProperties } from 'react';
import type { OwnerCalendarBlock } from '../../contracts';
import { formatDate } from './dates';
import { timelineDays, timelineSegments } from './owner-utils';

export function OwnerTimeline({ properties, blocks, from, toExclusive, onSelect }: { properties:{id:string;name:string}[];blocks:OwnerCalendarBlock[];from:string;toExclusive:string;onSelect:(block:OwnerCalendarBlock)=>void }) {
 const days=timelineDays(from,toExclusive);
 return <div className="owner-timeline-scroll" tabIndex={0} role="region" aria-label="Stay timeline; scroll horizontally to see all dates"><div className="owner-timeline" style={{'--owner-days':days.length} as CSSProperties}>
  <div className="owner-timeline-head"><span className="owner-unit-label">Unit</span><div className="owner-date-track">{days.map(date=><span key={date} title={formatDate(date)}>{date.slice(-2)}</span>)}</div></div>
  {properties.map(property=>{const segments=timelineSegments(blocks.filter(block=>block.propertyId===property.id),from,toExclusive);return <div className="owner-timeline-row" key={property.id} data-owner-unit={property.id}><h3 className="owner-unit-label">{property.name}</h3><div className="owner-stay-track" style={{minHeight:Math.max(70,(Math.max(-1,...segments.map(segment=>segment.lane))+1)*36+16)}}>
   <div className="owner-day-lines" aria-hidden="true">{days.map(date=><span key={date}/>)}</div>
   {!segments.length&&<p className="owner-no-stays">No stays reported in this range</p>}
   {segments.map(({block,start,end,lane,sameDay})=><button type="button" key={block.id} className={`owner-stay ${block.kind} ${block.removed?'removed':''} ${sameDay?'same-day':''} ${block.changes.some(change=>change.type==='conflict')?'conflict':''}`} title={sameDay?'Same-day event · zero nights':undefined} style={{left:`${(start+(sameDay ? 0.5 : 0))/days.length*100}%`,width:sameDay?28:`${(end-start)/days.length*100}%`,top:8+lane*36}} onClick={()=>onSelect(block)} aria-label={`${property.name}, ${sameDay?'Same-day event, zero nights, ':''}${block.removed?'Removed ':''}${block.kind==='reservation'?'Stay':block.kind==='blocked'?'Blocked period':'Unconfirmed period'}, ${formatDate(block.startDate)} to ${formatDate(block.endDate)}${block.changes.length?', changed':''}`}>
    {sameDay?<span aria-hidden="true">◆</span>:<>{block.removed?'Removed':block.kind==='reservation'?'Stay':block.kind==='blocked'?'Blocked':'Unconfirmed'}{block.changes.some(change=>change.type==='conflict')?' · Conflict':block.changes.length>0?' · Changed':''}{!block.removed&&segments.some(other=>other.block.id!==block.id&&!other.block.removed&&other.start<end&&start<other.end)?' · Overlap':''}</>}
   </button>)}
  </div></div>;})}
 </div></div>;
}
