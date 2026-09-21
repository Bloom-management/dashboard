'use client';
import { useMemo } from 'react';
import { Tooltip } from '@base-ui/react/tooltip';
import type { OwnerCalendarBlock } from '../../contracts';
import { BookingCalendar, calendarDate, calendarValue } from '../ui/calendar';
import { ownerPropertyColor } from './owner-colors';
import { formatDate } from './dates';

/** Allocate lanes per week so a stay never jumps rows within a week. Ends are exclusive. */
export function ownerWeekSegments(month:string,blocks:OwnerCalendarBlock[]) {
 const first=calendarDate(month);const last=new Date(first);last.setUTCMonth(last.getUTCMonth()+1);
 const weeks=new Map<string,{block:OwnerCalendarBlock;start:string;days:number;lane:number;continuesBefore:boolean;continuesAfter:boolean}[]>();
 const cursor=new Date(first);cursor.setUTCDate(cursor.getUTCDate()-cursor.getUTCDay());
 for(let week=0;week<6;week++){
  const end=new Date(cursor);end.setUTCDate(end.getUTCDate()+7);
  const startValue=calendarValue(cursor),endValue=calendarValue(end);
  const visibleStart=startValue<calendarValue(first)?calendarValue(first):startValue;
  const visibleEnd=endValue>calendarValue(last)?calendarValue(last):endValue;
  const lanes:string[]=[];
  const segments=[];
  for(const block of [...blocks].sort((a,b)=>a.startDate.localeCompare(b.startDate)||b.endDate.localeCompare(a.endDate)||a.id.localeCompare(b.id))){
   const effectiveEnd=block.endDate===block.startDate?calendarValue(new Date(calendarDate(block.startDate).getTime()+86400000)):block.endDate;
   const start=block.startDate>visibleStart?block.startDate:visibleStart;
   const finish=effectiveEnd<visibleEnd?effectiveEnd:visibleEnd;
   if(start>=finish)continue;
   let lane=lanes.findIndex(end=>end<=start);if(lane<0)lane=lanes.length;lanes[lane]=finish;
   segments.push({block,start,days:(calendarDate(finish).getTime()-calendarDate(start).getTime())/86400000,lane,continuesBefore:block.startDate<start,continuesAfter:effectiveEnd>finish});
  }
  weeks.set(startValue,segments);cursor.setUTCDate(cursor.getUTCDate()+7);
 }
 return weeks;
}
export function OwnerMonth({month,blocks,onSelect}:{month:string;blocks:OwnerCalendarBlock[];onSelect:(block:OwnerCalendarBlock)=>void}) {
 const weeks=useMemo(()=>ownerWeekSegments(month,blocks),[month,blocks]);
 return <BookingCalendar month={month} connected>{date=>{
  const week=calendarDate(date);week.setUTCDate(week.getUTCDate()-week.getUTCDay());
  const segments=weeks.get(calendarValue(week))??[];
  const lanes=Math.max(0,...segments.map(segment=>segment.lane+1));
  const barHeight=lanes<=3?28:lanes===4?25:22;
  const laneHeight=barHeight+4;
  return <div className="owner-week-lanes" style={{height:lanes*laneHeight}}>{segments.filter(segment=>segment.start===date).map(({block,days,lane,continuesBefore,continuesAfter})=>{
   const state=block.removed?'Removed':block.kind==='reservation'?'Stay':block.kind==='blocked'?'Blocked':'Unconfirmed';
   const conflict=block.changes.some(change=>change.type==='conflict');
   const source=[...new Set(block.providers)].map(provider=>provider==='airbnb'?'Airbnb':provider==='vrbo'?'Vrbo':provider).join(', ')||'Unknown';
   const detail=`${state}${conflict?' · Conflict':''} · ${formatDate(block.startDate)} to ${formatDate(block.endDate)}`;
   return <Tooltip.Root key={block.id}><Tooltip.Trigger delay={0} type="button" className={`owner-month-event owner-connected-stay ${block.kind}${block.removed?' removed':''}${conflict?' conflict':''}`} data-continues-before={continuesBefore||undefined} data-continues-after={continuesAfter||undefined} style={{background:ownerPropertyColor(block.propertyId),color:'#fff',height:barHeight,minHeight:barHeight,top:lane*laneHeight,left:6,width:`calc(${days*100}% + ${(days-1)} * var(--booking-gap) - 12px)`}} onClick={()=>onSelect(block)} aria-label={`${block.propertyName}, Source: ${source}, ${detail}`}><span className="owner-month-label">{block.propertyName}</span></Tooltip.Trigger><Tooltip.Portal><Tooltip.Positioner side="top" sideOffset={8} style={{zIndex:100}}><Tooltip.Popup className="bloom-booking-tooltip"><strong>{block.propertyName}</strong><span>Source: {source}</span><span>{detail}</span></Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal></Tooltip.Root>;
  })}</div>;
 }}</BookingCalendar>;
}
