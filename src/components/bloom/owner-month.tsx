'use client';
import { useMemo, useState } from 'react';
import { Tooltip } from '@base-ui/react/tooltip';
import {CalendarAddFlow,CalendarDayHeading,CalendarCleaningSummary} from './calendar-add-flow';
import type {CalendarAddCleaning,CalendarAddResult} from '../../contracts/calendar-add';
import type { OwnerCalendarBlock } from '../../contracts';
import { BookingCalendar, calendarDate, calendarValue } from '../ui/calendar';
import { ownerPropertyColor } from './owner-colors';
import {CleaningReport} from './cleaning-report';
import { Modal } from './primitives';
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
export function OwnerMonth({calendarType='bookings',month,blocks:allBlocks,onSelect,day,onDayChange,cleanings=[],initialPropertyId,onCreated,onViewDate}:{calendarType?:'cleanings'|'bookings';cleanings?:CalendarAddCleaning[];initialPropertyId?:string;onCreated?:(result:CalendarAddResult)=>void;onViewDate?:(date:string)=>void;month:string;blocks:OwnerCalendarBlock[];onSelect:(block:OwnerCalendarBlock)=>void;day?:string|null;onDayChange?:(day:string|null)=>void}) {
 const [reportJob,setReportJob]=useState<string|null>(null);
 const blocks=useMemo(()=>calendarType==='bookings'?allBlocks:[],[calendarType,allBlocks]);
 const [adding,setAdding]=useState(false),[started,setStarted]=useState(false),[saving,setSaving]=useState(false);
 const [localDay,setLocalDay]=useState<string|null>(null);
 const selectedDay=day===undefined?localDay:day;const setSelectedDay=onDayChange??setLocalDay;
 const dayBlocks=selectedDay?blocks.filter(block=>block.startDate<=selectedDay&&(block.endDate>selectedDay||(block.startDate===selectedDay&&block.endDate===selectedDay))):[];
 const weeks=useMemo(()=>ownerWeekSegments(month,allBlocks),[month,allBlocks]);
 const weekLanes=(date:string)=>{const week=calendarDate(date);week.setUTCDate(week.getUTCDate()-week.getUTCDay());const start=calendarValue(week);const end=new Date(week);end.setUTCDate(end.getUTCDate()+7);const counts=new Map<string,number>();for(const job of cleanings){if(job.date>=start&&job.date<calendarValue(end))counts.set(job.date,(counts.get(job.date)??0)+1);}return Math.max(0,...(weeks.get(start)??[]).map(segment=>segment.lane+1),...counts.values());};
 const minHeight=(date:string)=>40+weekLanes(date)*24;
 return <><BookingCalendar month={month} connected dayLabel={calendarType} onDaySelect={value=>{setAdding(false);setStarted(false);setSelectedDay(value);}} dayMinHeight={minHeight}>{date=>{
  const week=calendarDate(date);week.setUTCDate(week.getUTCDate()-week.getUTCDay());
  const segments=weeks.get(calendarValue(week))??[];
  const lanes=weekLanes(date);
  const barHeight=20;
  const laneHeight=barHeight+4;
  return <><div className="owner-week-lanes" style={{height:lanes*laneHeight}}>{segments.filter(segment=>calendarType==='bookings'&&segment.start===date).map(({block,days,lane,continuesBefore,continuesAfter})=>{
   const state=block.label??(block.removed?'Removed':block.kind==='reservation'?'Stay':block.kind==='blocked'?'Blocked':'Unconfirmed');
   const conflict=block.changes.some(change=>change.type==='conflict');
   const source=[...new Set(block.providers)].map(provider=>provider==='airbnb'?'Airbnb':provider==='vrbo'?'Vrbo':provider==='manual'?'Manual / direct':provider).join(', ')||'Unknown';
   const detail=`${state}${conflict?' · Conflict':''} · ${formatDate(block.startDate)} to ${formatDate(block.endDate)}`;
   return <Tooltip.Root key={block.id}><Tooltip.Trigger delay={0} type="button" className={`owner-month-event owner-connected-stay ${block.kind}${block.removed?' removed':''}${conflict?' conflict':''}`} data-continues-before={continuesBefore||undefined} data-continues-after={continuesAfter||undefined} style={{background:ownerPropertyColor(block.propertyId),color:'#fff',height:barHeight,minHeight:barHeight,top:lane*laneHeight,left:6,width:`calc(${days*100}% + ${(days-1)} * var(--booking-gap) - 12px)`}} onClick={()=>onSelect(block)} aria-label={`${block.propertyName}, Source: ${source}, ${detail}`}><span className="owner-month-label">{block.propertyName}</span></Tooltip.Trigger><Tooltip.Portal><Tooltip.Positioner side="top" sideOffset={8} style={{zIndex:100}}><Tooltip.Popup className="bloom-booking-tooltip"><strong>{block.propertyName}</strong><span>Source: {source}</span><span>{detail}</span></Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal></Tooltip.Root>;
  })}{(calendarType==='cleanings'?cleanings:[]).filter(job=>job.date===date).map((job,lane)=><button type="button" key={job.id} className="owner-month-event owner-cleaning-event" style={{position:'absolute',top:lane*laneHeight,left:6,width:'calc(100% - 12px)',height:barHeight,minHeight:barHeight}} aria-label={`${job.propertyName} · Cleaning`} onClick={()=>{setAdding(false);setStarted(false);setSelectedDay(date);}}><span className="owner-month-label">{job.propertyName}</span></button>)}</div></>;
 }}</BookingCalendar>{selectedDay&&<Modal className="cleaner-day-dialog" title={`${calendarType==='cleanings'?'Cleanings':'Bookings'} for ${formatDate(selectedDay)}`} onClose={()=>{if(saving)return;setAdding(false);setStarted(false);const date=selectedDay;setSelectedDay(null);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(`button[data-calendar-date="${date}"]`)?.focus());}}><div hidden={adding}><header><p className="cleaner-day-eyebrow">Your property calendar</p><CalendarDayHeading date={selectedDay} onAdd={()=>{setStarted(true);setAdding(true);}}/><p>{calendarType==='cleanings'?cleanings.filter(job=>job.date===selectedDay).length:dayBlocks.length} {calendarType} · Dates are local to each property</p></header>{calendarType==='bookings'&&(dayBlocks.length?<ul className="cleaner-day-jobs">{dayBlocks.map(block=><li key={block.id}><button type="button" onClick={()=>{setSelectedDay(null);onSelect(block);}}><strong>{block.propertyName}</strong><span>{block.label??(block.providers.map(provider=>provider==='airbnb'?'Airbnb':provider==='vrbo'?'Vrbo':'Direct booking').join(' · ')||'Source unavailable')} · {block.removed?'Removed':block.kind==='reservation'?'Stay':block.kind==='blocked'?'Blocked':'Unconfirmed'}</span><span>{formatDate(block.startDate)} – {formatDate(block.endDate)}</span><span className="cleaner-day-link">View booking →</span></button></li>)}</ul>:<p className="cleaner-day-empty">No bookings for this day with your current filters.</p>)}{(calendarType==='cleanings'?cleanings:[]).filter(job=>job.date===selectedDay).map(job=><article className="calendar-add-card" key={job.id}><div className="owner-cleaning-report-row"><CalendarCleaningSummary cleaning={job}/>{job.status==='completed'&&<button type="button" className="bloom-button secondary" onClick={()=>setReportJob(job.id)}>View cleaning report</button>}</div></article>)}</div>{started&&<CalendarAddFlow active={adding} date={selectedDay} initialPropertyId={initialPropertyId} onViewDate={onViewDate} onBack={()=>{setAdding(false);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('[data-calendar-add]')?.focus());}} onBusyChange={setSaving} onCreated={result=>onCreated?.(result)}/>}</Modal>}{reportJob&&<CleaningReport jobId={reportJob} onClose={()=>setReportJob(null)}/>}</>;
}
