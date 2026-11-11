'use client';
import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import type {CleanerJob} from '../../contracts';
import {CalendarGrid,ErrorNotice} from './primitives';
import {monthRange,shiftMonth} from './dates';
import {useCalendar} from './use-calendar';
import {Drawer,DrawerContent} from '../ui/drawer';

/** Phone layout (≤600px, matching the existing phone breakpoint). */
export function useIsPhone(){
 const [phone,setPhone]=useState(false);
 useEffect(()=>{const query=window.matchMedia('(max-width: 600px)');const update=()=>setPhone(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[]);
 return phone;
}

const monthLabel=(month:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'long',year:'numeric'}).format(new Date(`${month}-01T12:00:00Z`));
function scrollerOf(element:HTMLElement|null):HTMLElement{
 for(let node=element?.parentElement;node;node=node.parentElement){const overflow=getComputedStyle(node).overflowY;if((overflow==='auto'||overflow==='scroll')&&node.scrollHeight>node.clientHeight)return node;}
 return document.scrollingElement as HTMLElement;
}

/** One cleaner month: its own data request (the jobs API allows 92 days), title, then the shared grid with weekdays on the cells. */
export function CleanerPhoneMonth({month,scope,reloadToken,onJobs,onDaySelect,renderDay}:{month:string;scope:string;reloadToken:number;onJobs:(month:string,jobs:CleanerJob[])=>void;onDaySelect:(date:string)=>void;renderDay:(jobs:CleanerJob[],date:string)=>ReactNode}){
 const range=monthRange(month);
 const jobs=useCalendar<CleanerJob[]>(scope,`/jobs?from=${range.from}&to=${range.to}`);
 const {data,reload}=jobs;
 const first=useRef(true);
 useEffect(()=>{if(first.current){first.current=false;return;}reload();},[reloadToken,reload]);
 useEffect(()=>{if(data)onJobs(month,data);},[data,month,onJobs]);
 return <PhoneMonthSection month={month}>{jobs.error?<ErrorNotice error={jobs.error} retry={jobs.reload}/>:<CalendarGrid month={month} onDaySelect={onDaySelect}>{date=>renderDay(data??[],date)}</CalendarGrid>}</PhoneMonthSection>;
}
/** Month wrapper used by every phone calendar: anchor id, title, then that month's grid. */
export function PhoneMonthSection({month,children}:{month:string;children:ReactNode}){
 return <section className="phone-month" id={`phone-month-${month}`} aria-label={monthLabel(month)}><h2 className="phone-month-title">{monthLabel(month)}</h2>{children}</section>;
}

/** Google-Calendar-style vertical scroll of months; more months load at either end. */
export function PhoneMonths({anchor,todayRequest,renderMonth}:{anchor:string;todayRequest:number;renderMonth:(month:string)=>ReactNode}){
 const [months,setMonths]=useState(()=>[shiftMonth(anchor,-1),anchor,shiftMonth(anchor,1),shiftMonth(anchor,2)]);
 const list=useRef<HTMLDivElement>(null),top=useRef<HTMLDivElement>(null),bottom=useRef<HTMLDivElement>(null);
 const prepend=useRef<{scroller:HTMLElement;height:number}|null>(null);
 const ready=useRef(false);
 useLayoutEffect(()=>{
  // The pinned header height decides where a month lands when scrolled to.
  const header=document.querySelector<HTMLElement>('.app .topbar');if(header)document.documentElement.style.setProperty('--phone-header-height',`${header.offsetHeight+8}px`);
  document.getElementById(`phone-month-${anchor}`)?.scrollIntoView({block:'start'});ready.current=true;
 },[anchor]);
 // Keep the visible month in place when an earlier month is inserted above it.
 useLayoutEffect(()=>{const pending=prepend.current;if(!pending)return;prepend.current=null;pending.scroller.scrollTop+=pending.scroller.scrollHeight-pending.height;},[months]);
 useEffect(()=>{
  const observer=new IntersectionObserver(entries=>{
   if(!ready.current)return;
   for(const entry of entries){
    if(!entry.isIntersecting)continue;
    if(entry.target===bottom.current)setMonths(current=>[...current,shiftMonth(current[current.length-1],1),shiftMonth(current[current.length-1],2)]);
    else if(entry.target===top.current&&!prepend.current){const scroller=scrollerOf(list.current);prepend.current={scroller,height:scroller.scrollHeight};setMonths(current=>[shiftMonth(current[0],-1),...current]);}
   }
  },{rootMargin:'400px 0px'});
  if(top.current)observer.observe(top.current);if(bottom.current)observer.observe(bottom.current);
  return()=>observer.disconnect();
 },[]);
 // Today: bring today's month into view and centre today's cell.
 useEffect(()=>{if(!todayRequest)return;document.querySelector('.phone-months td[data-current-date]')?.scrollIntoView({block:'center',behavior:'smooth'});},[todayRequest]);
 return <div ref={list} className="phone-months"><div ref={top} className="phone-months-edge" aria-hidden="true"/>{months.map(month=><div key={month}>{renderMonth(month)}</div>)}<div ref={bottom} className="phone-months-edge" aria-hidden="true"/></div>;
}

/** Filters drawer: Bloom opportunities, then a searchable property checklist applied with "Show …". */
export function CalendarFilters({open,onOpenChange,properties,selected,onApply,network,children,countLabel=['job','jobs']}:{open:boolean;onOpenChange:(open:boolean)=>void;properties:{id:string;name:string;count:number}[];selected:string[]|null;onApply:(selected:string[]|null)=>void;network?:ReactNode;children?:ReactNode;countLabel?:[string,string]}){
 const [draft,setDraft]=useState<Set<string>>(new Set());
 const [root,setRoot]=useState<HTMLElement|null>(null);
 useEffect(()=>{setRoot(document.querySelector<HTMLElement>('.app'));},[]);
 const [query,setQuery]=useState('');
 useEffect(()=>{if(open){setDraft(new Set(selected??properties.map(p=>p.id)));setQuery('');}},[open]); // Reset the draft only when the drawer opens.
 const all=properties.length>0&&properties.every(p=>draft.has(p.id));
 const shown=properties.filter(p=>p.name.toLowerCase().includes(query.trim().toLowerCase()));
 const toggle=(id:string)=>setDraft(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});
 const count=draft.size;
 return <Drawer open={open} onOpenChange={onOpenChange}><DrawerContent container={root} title="Filters" footer={<><button type="button" className="calendar-filter-reset" onClick={()=>setDraft(new Set(properties.map(p=>p.id)))}>Reset</button><button type="button" className="bloom-button calendar-filter-apply" disabled={!count} onClick={()=>{onApply(all?null:[...draft]);onOpenChange(false);}}>{all?`Show all ${properties.length} properties`:`Show ${count} ${count===1?'property':'properties'}`}</button></>}>
  {children}{network&&<div className="calendar-filter-network"><div><strong>Bloom opportunities</strong><small>Show eligible Bloom cleanings</small></div>{network}</div>}
  <h3 className="calendar-filter-heading">Properties</h3>
  <input type="search" className="calendar-filter-search" placeholder="Search properties" aria-label="Search properties" value={query} onChange={event=>setQuery(event.target.value)}/>
  <ul className="calendar-filter-list">
   {!query.trim()&&<li><label className="calendar-filter-all"><input type="checkbox" checked={all} onChange={()=>setDraft(all?new Set():new Set(properties.map(p=>p.id)))}/><strong>All properties</strong><span>{properties.length}</span></label></li>}
   {shown.map(p=><li key={p.id}><label><input type="checkbox" checked={draft.has(p.id)} onChange={()=>toggle(p.id)}/><span className="calendar-filter-name">{p.name}</span><span>{p.count} {p.count===1?countLabel[0]:countLabel[1]}</span></label></li>)}
   {!shown.length&&<li className="calendar-filter-empty">No properties match.</li>}
  </ul>
 </DrawerContent></Drawer>;
}
