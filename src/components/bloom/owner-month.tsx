import type { OwnerCalendarBlock } from '../../contracts';
import { BookingCalendar } from '../ui/calendar';
import { ownerPropertyColor } from './owner-colors';
import { formatDate } from './dates';

export function OwnerMonth({month,blocks,onSelect}:{month:string;blocks:OwnerCalendarBlock[];onSelect:(block:OwnerCalendarBlock)=>void}) {
 return <BookingCalendar month={month}>{date=>blocks.filter(block=>block.startDate===block.endDate?date===block.startDate:block.startDate<=date&&date<block.endDate).map(block=>{
 const state=block.removed?'Removed':block.kind==='reservation'?'Stay':block.kind==='blocked'?'Blocked':'Unconfirmed';
 const conflict=block.changes.some(change=>change.type==='conflict');
 const overlap=!block.removed&&blocks.some(other=>other.id!==block.id&&other.propertyId===block.propertyId&&!other.removed&&other.startDate<=date&&date<other.endDate);
 const detail=`${state}${conflict?' · Conflict':overlap?' · Overlap':''}${block.startDate===block.endDate?' · Same-day, zero nights':''}`;
 return <button key={block.id} type="button" className={`owner-month-event ${block.kind}${block.removed?' removed':''}${conflict?' conflict':''}`} onClick={()=>onSelect(block)} title={`${block.propertyName} · ${detail}`} aria-label={`${block.propertyName}, ${detail}, ${formatDate(date)}`}><span className="owner-month-label"><span className="owner-event-dot" style={{background:ownerPropertyColor(block.propertyId)}} aria-hidden="true"/>{block.propertyName}</span><span className="owner-month-status">{detail}</span></button>;
 })}</BookingCalendar>;
}
