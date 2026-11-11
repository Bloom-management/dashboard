'use client';
import {useCallback,useState} from 'react';
import type {RoomCompletionSummary,RoomIssues} from '../../../contracts/room-summary';
import {api,request} from '../api';
import {ErrorNotice,Loading,useResource} from '../primitives';
import {Photo} from '../photos';
import {AnimatedContent} from '../animated-content';
import {Icon} from '../primitives';
import {RoomPicker} from './room-picker';
import {SupplyIcon} from '../supply-setup-grid';
import {SupplyLevelBar} from '../supply-level-bar';
import {CompletionPhotos} from '../photos';
import type {SupplyLevel} from '../../../contracts';
import {supplyLevels} from '../journey-draft';
import styles from './drafts.module.css';
import reportStyles from '../cleaner-journey.module.css';
import {categoryLabel} from './category';

export function RoomReportItems({summary,kind,jobId,issues,onResolved}:{summary:RoomCompletionSummary;kind:'supply'|'maintenance';jobId?:string;issues?:RoomIssues;onResolved?:()=>void}) {
 // Open where the first unresolved issue is, so the owner lands on it.
 const firstIssue=summary.items.find(i=>issues?.issues.some(x=>x.itemId===i.id&&!x.resolvedAt));
 const [scope,setScope]=useState<'room'|'shared'>(()=>firstIssue?firstIssue.scope:summary.items.some(i=>i.kind===kind&&i.scope==='room')?'room':'shared');
 const [room,setRoom]=useState(firstIssue?.propertyId??summary.rooms[0]?.propertyId??'');
 const [open,setOpen]=useState<string|null>(null);
 const items=summary.items.filter(i=>i.kind===kind&&i.scope===scope&&(scope==='shared'||i.propertyId===room));
 const issueOf=(id:string)=>kind==='maintenance'?issues?.issues.find(x=>x.itemId===id):undefined;
 return <div className={styles.houseItems}>
  <div className={styles.choices}>{(['room','shared'] as const).map(s=><button type="button" key={s} aria-pressed={scope===s} onClick={()=>setScope(s)}><Icon name={s==='room'?'grid':'house'} size={28}/><strong>{s==='room'?'Room':'Shared'}</strong></button>)}</div>
  {scope==='room'&&<RoomPicker rooms={summary.rooms} value={room} onChange={setRoom}/>}
  <hr className={styles.sectionDivider}/>
  {/* Opening or closing an issue resizes the grid with the shared easing. */}
  <AnimatedContent><div className={reportStyles.receiptSupplies}>{items.map(i=>{
   const issue=issueOf(i.id);
   const body=<>{kind==='supply'&&<SupplyIcon/>}<small>{categoryLabel(i.category)}</small><strong>{i.name}</strong>
    <span>{!i.value?'Not reported':kind==='supply'?supplyLevels[i.value as SupplyLevel]:issue?.resolvedAt?'Resolved':({good:'Good',issue:'Needs attention',not_applicable:'Not applicable'}[i.value]??i.value)}</span>
    {kind==='supply'&&i.value&&<SupplyLevelBar level={i.value as SupplyLevel}/>}</>;
   if(!issue||!jobId)return <article className={reportStyles.receiptSupply} key={i.id}>{body}</article>;
   return [<button type="button" className={`${reportStyles.receiptSupply} ${styles.issueCard}`} key={i.id} aria-expanded={open===i.id} onClick={()=>setOpen(open===i.id?null:i.id)}>
     {!issue.resolvedAt&&<span className={styles.issueBadge} aria-label="Unresolved issue">!</span>}{body}
    </button>,
    open===i.id&&<IssueDetails key={`${i.id}:details`} jobId={jobId} name={i.name} issue={issue} canResolve={!!issues?.canResolve} onResolved={onResolved}/>];
  })}</div></AnimatedContent>{!items.length&&<p>No {scope==='shared'?'shared':'room'} {kind==='supply'?'supplies':'maintenance items'}</p>}
 </div>;
}
export function RoomReportPhotos({jobId,summary}:{jobId:string;summary:RoomCompletionSummary}) {
 const [room,setRoom]=useState(summary.rooms[0]?.propertyId??'shared');
 const spaces=summary.spaces.filter(s=>room==='shared'?s.scope==='shared':s.propertyId===room);
 return <div className={styles.houseItems}><RoomPicker rooms={summary.rooms} value={room} onChange={setRoom} shared/><CompletionPhotos jobId={jobId} spaces={spaces}/></div>;
}

/** Expanded maintenance issue: the cleaner's comment and photos; owners/admins can mark it resolved. */
function IssueDetails({jobId,name,issue,canResolve,onResolved}:{jobId:string;name:string;issue:RoomIssues['issues'][number];canResolve:boolean;onResolved?:()=>void}){
 const load=useCallback(async(signal:AbortSignal)=>(await api.photos(jobId,signal)).filter(photo=>photo.noteContext==='maintenance'&&photo.roomId===issue.itemId&&photo.state==='ready'),[jobId,issue.itemId]);
 const photos=useResource(load);
 const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
 async function resolve(){if(busy)return;setBusy(true);setError(undefined);try{await request(`/jobs/${jobId}/issues`,{body:{itemId:issue.itemId},key:crypto.randomUUID()});onResolved?.();}catch(e){setError(e);}finally{setBusy(false);}}
 return <section className={styles.issuePanel} aria-label={`${name} issue`}>
  <p className="bloom-prewrap">{issue.notes||'No comment provided.'}</p>
  {photos.loading?<Loading/>:photos.error?<ErrorNotice error={photos.error} retry={photos.reload}/>:!!photos.data?.length&&<div className="bloom-photo-strip">{photos.data.map(photo=><Photo key={photo.id} photo={photo} jobId={jobId} label={photo.uploaderName??'Cleaner'}/>)}</div>}
  {issue.resolvedAt?<p className={styles.issueResolved}>Resolved{issue.resolvedByName?` by ${issue.resolvedByName}`:''} · {new Date(issue.resolvedAt).toLocaleString()}</p>:canResolve&&<button type="button" className="bloom-button" disabled={busy} onClick={()=>void resolve()}>{busy?'Saving…':'Mark resolved'}</button>}
  {error!=null&&<ErrorNotice error={error}/>}
 </section>;
}

/** Live issues for a room visit; null for whole-home jobs. */
export function useRoomIssues(jobId:string,enabled:boolean){
 const load=useCallback((signal:AbortSignal)=>enabled?request<RoomIssues>(`/jobs/${jobId}/issues`,{signal}):Promise.resolve(null),[jobId,enabled]);
 return useResource(load,true);
}

