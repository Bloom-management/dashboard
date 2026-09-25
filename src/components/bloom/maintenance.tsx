'use client';
import {DialogLoading} from './dialog-loading';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { GroupImperativeHandle } from 'react-resizable-panels';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../ui/resizable';
import { request } from './api';
import { ErrorNotice, Loading, Modal, useResource } from './primitives';
import type { MaintenanceAnswer, MaintenanceCategory, MaintenanceReport } from '../../contracts/maintenance';
import { maintenanceStatuses } from '../../contracts/maintenance';
import type { CleaningConfig, SupplyLevel } from '../../contracts';
import { SupplyIcon } from './supply-setup-grid';
const levels:Record<SupplyLevel,string>={full:'Full',moderate:'Moderate',low:'Low',empty:'Empty',not_found:'Not found'};
const maintenanceItems=[
 {category:'painting' as MaintenanceCategory,label:'Painting',path:'M4 3h13v6H4zM17 5h3v7h-8v8M10 20h4'},
 {category:'fridge' as MaintenanceCategory,label:'Fridge',path:'M6 2h12v20H6zM6 10h12M9 5v2M9 13v3'},
 {category:'electricity' as MaintenanceCategory,label:'Electricity',path:'m13 2-8 12h6l-1 8 9-13h-7l1-7Z'},
 {category:'wifi' as MaintenanceCategory,label:'Wi-Fi',path:'M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0M12 20h.01'},
 {category:'tv' as MaintenanceCategory,label:'TV',path:'M3 6h18v13H3zM8 2l4 4 4-4M8 22h8'},
 {category:'garage' as MaintenanceCategory,label:'Garage',path:'M3 10 12 3l9 7v11H3V10ZM6 21V11h12v10M6 14h12M6 17h12'},
 {category:'climate' as MaintenanceCategory,label:'AC / heater',path:'M3 4h18v9H3zM6 9h12M7 16v5M12 16v3M17 16v5'},
 {category:'water' as MaintenanceCategory,label:'Water',path:'M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13ZM8 15a4 4 0 0 0 4 4'},
];
export function MaintenanceGrid({reports=[],showHeading=true}:{reports?:MaintenanceReport[];showHeading?:boolean}){
 return <>{showHeading&&<h3>Maintenance</h3>}<p>Last reported condition · Unreported items have not been checked.</p><div className="maintenance-grid owner-supply-grid">{maintenanceItems.map(item=>{const report=reports.find(r=>r.category===item.category);return <article key={item.category} className="maintenance-card owner-supply-card" data-level={report?.status==='attention'?'low':'unknown'}><MaintenanceIcon path={item.path}/><strong>{item.label}</strong><span>{report?maintenanceStatuses[report.status]:'Not reported'}</span>{report?.notes&&<p>{report.notes}</p>}{report?.reportedAt&&<small>Last reported {new Date(report.reportedAt).toLocaleString()}</small>}</article>;})}</div></>;
}
function MaintenanceIcon({path}:{path:string}){return <svg width="28" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path}/></svg>;}
export function MaintenanceCheck({answers,onChange,disabled}:{answers:Partial<Record<MaintenanceCategory,MaintenanceAnswer>>;onChange:(answers:Partial<Record<MaintenanceCategory,MaintenanceAnswer>>)=>void;disabled:boolean}){
 const root=useRef<HTMLDivElement>(null);
 const horizontal=useRef<GroupImperativeHandle>(null);
 const vertical=useRef<Record<number,GroupImperativeHandle|null>>({});
 const [columns,setColumns]=useState(3);
 const [expanded,setExpanded]=useState<MaintenanceCategory|null>(null);
 useEffect(()=>{
  const observer=new ResizeObserver(([entry])=>setColumns(entry.contentRect.width<440?1:entry.contentRect.width<740?2:3));
  if(root.current)observer.observe(root.current);
  return ()=>observer.disconnect();
 },[]);
 const animation=useRef<number>(0);
 useEffect(()=>()=>cancelAnimationFrame(animation.current),[]);
 function animateLayout(group:GroupImperativeHandle|null|undefined,target:Record<string,number>){
  if(!group)return null;
  return {group,target,start:group.getLayout()};
 }
 const rows=Math.ceil(maintenanceItems.length/columns);
 function expand(category:MaintenanceCategory|null){
  setExpanded(category);
  const index=maintenanceItems.findIndex(item=>item.category===category);
  const selectedColumn=index%columns;
  cancelAnimationFrame(animation.current);
  const layouts=[animateLayout(horizontal.current,Object.fromEntries(Array.from({length:columns},(_,col)=>[String(col),index<0?100/columns:columns===1?100:col===selectedColumn?50:50/(columns-1)])))];
  for(let col=0;col<columns;col++){
   layouts.push(animateLayout(vertical.current[col],Object.fromEntries(Array.from({length:rows},(_,row)=>[String(row),index>=0&&col===selectedColumn?(row===Math.floor(index/columns)?(rows===1?100:Math.min(50,150/rows)):(100-Math.min(50,150/rows))/(rows-1)):100/rows]))));
  }
  const start=performance.now();
  const duration=window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:360;
  function frame(now:number){
   const progress=duration?Math.min(1,(now-start)/duration):1;
   const eased=1-Math.pow(1-progress,3);
   for(const layout of layouts){if(layout)layout.group.setLayout(Object.fromEntries(Object.entries(layout.target).map(([key,value])=>[key,(layout.start[key]??value)+(value-(layout.start[key]??value))*eased])));}
   if(progress<1)animation.current=requestAnimationFrame(frame);
  }
  animation.current=requestAnimationFrame(frame);
 }
 return <div ref={root} className="maintenance-check maintenance-workspace" style={{aspectRatio:`${columns} / ${rows}`}}>
  <ResizablePanelGroup key={columns} orientation="horizontal" groupRef={horizontal}>
   {Array.from({length:columns},(_,col)=><Fragment key={col}>
    {col>0&&<ResizableHandle className="maintenance-boundary" aria-label="Resize maintenance columns"/>}
    <ResizablePanel id={String(col)} minSize="20%" defaultSize={`${100/columns}%`}>
     <ResizablePanelGroup orientation="vertical" groupRef={value=>{vertical.current[col]=value;}}>
      {Array.from({length:rows},(_,row)=>{
       const item=maintenanceItems[row*columns+col];
       const answer=item&&answers[item.category];
       return <Fragment key={row}>
        {row>0&&<ResizableHandle className="maintenance-boundary" aria-label="Resize maintenance cards"/>}
        <ResizablePanel id={String(row)} minSize={`${45/rows}%`} defaultSize={`${100/rows}%`}>
         {item&&<fieldset className="maintenance-card maintenance-report-card" disabled={disabled} data-category={item.category}>
          <legend>{item.label}</legend>
          <div className="maintenance-options">
           {Object.entries(maintenanceStatuses).filter(([status])=>status!=='not_applicable').map(([status,label])=><button type="button" key={status} className="maintenance-choice" aria-label={`${item.label}: ${label}`} aria-pressed={answer?.status===status} onClick={()=>{
            onChange({...answers,[item.category]:{category:item.category,status:answer?.status===status?'not_applicable':status as MaintenanceAnswer['status'],notes:answer?.notes??''}});
            if(status==='attention'&&answer?.status!==status)expand(item.category);else expand(null);
           }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
             {status==='not_applicable'?<><path d="M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4M12 18h.01"/></>:<><path d={item.path}/>{status==='attention'&&<path d="M2 2l20 20" strokeWidth="2.5"/>}</>}
            </svg><span>{label}</span>
           </button>)}
          </div>
          {answer?.status==='attention'&&expanded===item.category&&<label>{item.label} issue<textarea aria-label={`${item.label} issue`} required maxLength={500} value={answer.notes} onFocus={()=>{if(expanded!==item.category)expand(item.category);}} onChange={event=>onChange({...answers,[item.category]:{...answer,notes:event.target.value}})}/></label>}
         </fieldset>}
        </ResizablePanel>
       </Fragment>;
      })}
     </ResizablePanelGroup>
    </ResizablePanel>
   </Fragment>)}
  </ResizablePanelGroup>
 </div>;
}
export function SupplyReferenceGrid({supplies,reports=[],compact=true}:{compact?:boolean;supplies:CleaningConfig['supplies'];reports?:{supplyId:string;level:SupplyLevel;reportedAt:string}[]}){
 const [expanded,setExpanded]=useState(false);
 const grid=(items:typeof supplies)=><div className="maintenance-grid owner-supply-grid">{items.map(s=>{const r=reports.find(x=>x.supplyId===s.id);return <article className="maintenance-card owner-supply-card" key={s.id} data-level={r?.level??'full'}><SupplyIcon/><strong>{s.name}</strong><span>{r?levels[r.level]:'Full'}</span>{r&&<small>Last reported {new Date(r.reportedAt).toLocaleString()}</small>}</article>;})}</div>;
 return supplies.length?<>{grid(compact?supplies.slice(0,4):supplies)}{compact&&supplies.length>4&&<button type="button" className="bloom-button secondary" aria-haspopup="dialog" onClick={()=>setExpanded(true)}>+{supplies.length-4} supplies</button>}{expanded&&<Modal title="All supplies" className="bloom-dialog-surface bloom-supplies-dialog" onClose={()=>setExpanded(false)}><h2>Supplies</h2>{grid(supplies)}</Modal>}</>:<p>No supplies are configured for this cleaning.</p>;
}

export function JobSupplies({jobId,compact=true}:{jobId:string;compact?:boolean}){const load=useCallback((signal:AbortSignal)=>request<{supplies:CleaningConfig['supplies'];reports:{supplyId:string;level:SupplyLevel;reportedAt:string}[]}>(`/jobs/${jobId}/supplies`,{signal}),[jobId]);const data=useResource(load);return data.loading?(compact?<Loading/>:<DialogLoading/>):data.error?<ErrorNotice error={data.error} retry={data.reload}/>:data.data?<SupplyReferenceGrid compact={compact} supplies={data.data.supplies} reports={data.data.reports}/>:null;}

export function MaintenancePreview(){return <span className="bloom-section-preview" aria-hidden="true">{maintenanceItems.slice(0,4).map(item=><span className="bloom-section-mini" key={item.category} title={item.label}><MaintenanceIcon path={item.path}/></span>)}</span>;}
export function SupplyPreview({jobId}:{jobId:string}){
 const load=useCallback((signal:AbortSignal)=>request<{supplies:CleaningConfig['supplies']}>(`/jobs/${jobId}/supplies`,{signal}),[jobId]);const data=useResource(load);
 return <span className="bloom-section-preview" aria-hidden="true">{data.data?.supplies.slice(0,4).map(item=><span className="bloom-section-mini" key={item.id} title={item.name}><SupplyIcon/></span>)}{!data.data?.supplies.length&&<span className="bloom-section-preview-empty">{data.loading?'Loading…':data.error?'View supplies':'No supplies'}</span>}</span>;
}
