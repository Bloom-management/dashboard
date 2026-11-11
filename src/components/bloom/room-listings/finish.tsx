'use client';
import {useEffect,useRef,useState} from 'react';
import type {CleanerJob,CompletionResult,SessionUser} from '../../../contracts';
import type {RoomVisit} from '../../../contracts/room-visits';
import type {BloomIntegration} from '../integration';
import {api,request,ApiError} from '../api';
import {Modal,ErrorNotice, Icon} from '../primitives';
import {Photos} from '../photos';
import {RoomPicker} from './room-picker';
import {RoomSupplyCheck,loadRoomItems,reportSupply,reportedThisVisit} from './supply-check';
import {RoomMaintenanceCheck,loadIssueNotes,pendingIssueNotes,reportMaintenance} from './maintenance-check';
import {GuestStars} from '../guest-stars';
import {CompletionSteps} from '../cleaner-journey';
import {CleaningReport} from '../cleaning-report';
import {ButtonContent} from '../button-content';
import {GuestComment} from '../guest-comment';
import {useJobTeam} from '../cleaner-identity';
import {JobMaintenance,JobSupplies} from '../maintenance';
import {AccessInfo} from '../access-info';
import {JobDetailsDialog,JobReferenceDialog,ReferenceButton,ReferenceIcon} from '../job-reference';
import styles from '../cleaner-journey.module.css';
import roomStyles from './drafts.module.css';

type Step='photos'|'supplies'|'maintenance'|'guest';
type Input={configVersion:number;answers:never[];notes:string;maintenance:never[];guestReview:{rating:number;comment:string}};
type Draft={step:Step;notes:string;rating:number;comment:string;pending?:{key:string;input:Input}};
const steps:Step[]=['photos','supplies','maintenance','guest'];
const titles={photos:'A clear photo of every room.',supplies:'Leave the next cleaner ready.',maintenance:'Check what needs attention.',guest:'How did the guest leave the property?'};
export function RoomFinishDialog({visit,user,integration,onBack,onClose,onUpdate}:{visit:RoomVisit;user:SessionUser;integration:BloomIntegration;onBack:()=>void;onClose:()=>void;onUpdate:(job:CleanerJob)=>void}){
 const [current,setCurrent]=useState(visit),[room,setRoom]=useState(visit.rooms.find(r=>r.included)?.propertyId??'shared');
 const [draft,setDraft]=useState<Draft>({step:'photos',notes:'',rating:0,comment:''});
 const [hydrated,setHydrated]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[done,setDone]=useState(false),[uploading,setUploading]=useState(false);
 const lock=useRef(false),heading=useRef<HTMLHeadingElement>(null);
 const [detailsOpen,setDetailsOpen]=useState(false),[referenceOpen,setReferenceOpen]=useState(false),[referenceStep,setReferenceStep]=useState(0);
 const team=useJobTeam(visit.job.id,visit.job.version);
 // With a partner, missing photos or checks don't block the steps; the partner is notified instead.
 const teammate=(team.data?.length??0)>1;
 const [hint,setHint]=useState(''),[handoffMessage,setHandoffMessage]=useState('');
 const key=`bloom:room-finish:${user.id}:${visit.job.id}`;
 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem(key)??localStorage.getItem(`bloom:room-visit:${user.id}:${visit.job.id}`)??'null');if(saved)setDraft({step:steps.includes(saved.step)?saved.step:'photos',notes:saved.notes??'',rating:Number(saved.rating)||0,comment:saved.comment??'',pending:saved.pending});}catch{}setHydrated(true);},[key,user.id,visit.job.id]);
 useEffect(()=>{if(hydrated&&!done)try{localStorage.setItem(key,JSON.stringify(draft));}catch{}},[key,draft,hydrated,done]);
 useEffect(()=>{heading.current?.focus({preventScroll:true});},[draft.step]);
 const included=current.rooms.filter(r=>r.included),index=({photos:0,supplies:1,maintenance:2,guest:3} as const)[draft.step];
 const selected=included.find(r=>r.propertyId===room)?.propertyId??included[0]?.propertyId;
 const spaces=current.spaces.filter(s=>room==='shared'?s.scope==='shared':s.propertyId===selected);
 const frozen=busy||!!draft.pending||current.job.reviewRequired||!hydrated;
 const outstanding=!current.completion.photos||!current.completion.supplies||!current.completion.maintenance||current.spaces.some(s=>!s.done);
 const spaceName=(space:RoomVisit['spaces'][number])=>{const unit=current.rooms.find(r=>r.propertyId===space.propertyId)?.identifier;return space.scope==='shared'||!unit||space.label.includes(unit)?space.label:`${unit} ${space.label}`;};
 const listOf=(names:string[])=>new Intl.ListFormat('en',{type:'conjunction'}).format(names);
 async function next(){if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);setHint('');try{
  if(draft.step==='supplies'||draft.step==='maintenance'){
   // Like the whole-home check: untouched supplies default to Full and maintenance to No issue.
   const kind=draft.step==='supplies'?'supply':'maintenance';const seen=new Set<string>();
   if(kind==='maintenance'){
    // Like the whole-home check, anything marked "Needs attention" needs a short note.
    await Promise.all([...pendingIssueNotes]);const notes=await loadIssueNotes(current.job.id);const missing:string[]=[];
    for(const unit of included)for(const item of await loadRoomItems(unit.propertyId,current.job.id))if(item.kind==='maintenance'&&item.value==='issue'&&reportedThisVisit(item,current.startedAt)&&!notes[item.id]&&!missing.includes(item.name))missing.push(item.name);
    if(missing.length){setHint(`Please add a note for ${listOf(missing)}.`);return;}
   }
   for(const unit of included){for(const item of await loadRoomItems(unit.propertyId,current.job.id)){
    if(item.kind!==kind||seen.has(item.id))continue;seen.add(item.id);
    if(reportedThisVisit(item,current.startedAt))continue;
    if(kind==='supply')await reportSupply(unit.propertyId,current.job.id,item,'full');else await reportMaintenance(unit.propertyId,current.job.id,item,'good');
   }}
  }
  const fresh=await request<RoomVisit>(`/jobs/${current.job.id}/room-visit`);setCurrent(fresh);
  if(fresh.job.status==='completed'){setDone(true);onUpdate(fresh.job);return;}
  if(fresh.job.reviewRequired)throw new ApiError('REVIEW_REQUIRED','Booking changes need owner review.');
  if(draft.step==='photos'){
   const photos=await api.photos(fresh.job.id);
   const photographed=(space:RoomVisit['spaces'][number])=>photos.some(photo=>photo.roomId===space.id&&photo.state==='ready'&&!photo.noteContext);
   const missing=fresh.spaces.filter(space=>!photographed(space));
   if(missing.length&&!teammate){setHint(`Please upload a photo for ${listOf(missing.map(spaceName))}.`);return;}
   // A photo is the proof a space was cleaned; the partner's spaces are ticked when their photos arrive.
   let job=fresh.job;for(const space of fresh.spaces.filter(s=>!s.done&&photographed(s))){const body={action:'space',data:{spaceId:space.id,done:true},version:job.version};const result=await request<RoomVisit>(`/jobs/${job.id}/room-visit`,{body,key:crypto.randomUUID()});job=result.job;setCurrent(result);onUpdate(result.job);}}
  else if(draft.step!=='guest'&&!fresh.completion[draft.step]&&!teammate){setHint(draft.step==='supplies'?'Please report the supplies for each room and Shared.':'Please check maintenance for each room and Shared.');return;}
  setDraft(d=>({...d,step:steps[index+1]}));
 }catch(e){setError(e);}finally{lock.current=false;setBusy(false);}}
 async function askTeammate(){if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);setHandoffMessage('');try{
  const shared=await request<{revision:number}>(`/jobs/${current.job.id}/handoff`);
  const reviewed=[...(current.completion.supplies?['supplies']:[]),...(current.completion.maintenance?['maintenance']:[])];
  await request(`/jobs/${current.job.id}/handoff`,{body:{revision:shared.revision,draft:{version:current.job.scopeRevision??1,answers:{},maintenance:{},notes:draft.notes,reviewed,guestReview:{rating:draft.rating,comment:draft.comment}}},key:crypto.randomUUID()});
  setHandoffMessage('Your teammate has been notified about what is still missing and can submit the cleaning.');
 }catch(e){setError(e);}finally{lock.current=false;setBusy(false);}}
 async function finish(){if(lock.current||!draft.rating)return;lock.current=true;setBusy(true);setError(undefined);
 const submission=draft.pending??{key:crypto.randomUUID(),input:{configVersion:current.job.scopeRevision??1,answers:[] as never[],notes:draft.notes,maintenance:[] as never[],guestReview:{rating:draft.rating,comment:draft.comment}}};
 try{localStorage.setItem(key,JSON.stringify({...draft,pending:submission}));setDraft(d=>({...d,pending:submission}));
  const result=await request<CompletionResult>(`/jobs/${current.job.id}/complete`,{body:submission.input,key:submission.key});setDone(true);localStorage.removeItem(key);localStorage.removeItem(`bloom:room-visit:${user.id}:${visit.job.id}`);onUpdate(result.job);
 }catch(e){setError(e);if(e instanceof ApiError&&!['NETWORK_ERROR','SOURCE_UNAVAILABLE','SERVICE_UNAVAILABLE'].includes(e.code)){setDraft(d=>({...d,pending:undefined,...(e.code==='CONFLICT'?{step:'photos' as const}:{})}));if(e.code==='CONFLICT')try{setCurrent(await request<RoomVisit>(`/jobs/${current.job.id}/room-visit`));}catch{}}}finally{lock.current=false;setBusy(false);}}
 if(done)return <CleaningReport jobId={current.job.id} onClose={onClose}/>;
 return <Modal className={`detail-card bloom-job-frame bloom-job-surface ${styles.dialog}`} title={`${current.job.propertyName} cleaning`} onClose={onClose}>
  <div className={styles.layout}><section className={styles.task}>
   <p className={styles.factsEyebrow}>{current.job.management==='private'?'Your cleaning team':'Bloom Cleaning'} · Paid by {current.job.payerName??'Bloom'}</p>
   <header data-modal-header className={styles.heading}><div className={styles.headingRow}><span className={styles.kicker}>Finish cleaning · Step {index+1} of 4</span><button type="button" className={`bloom-button secondary ${styles.detailsButton}`} aria-haspopup="dialog" onClick={()=>setDetailsOpen(true)}>Job details and rates</button></div><h1 ref={heading} tabIndex={-1}>{titles[draft.step]}</h1><p>Your team shares the same room photos. Either assigned cleaner can submit for everyone.</p><CompletionSteps current={index}/></header>
   <div className={styles.content}>
    {draft.step==='photos'?<><RoomPicker rooms={included} value={room==='shared'?'shared':selected??''} onChange={setRoom} shared disabled={busy}/><Photos job={current.job} user={user} integration={integration} rooms={spaces} locked={frozen} onPendingChange={setUploading}/><label className={styles.notes}>Cleaning notes (optional)<textarea maxLength={1500} disabled={frozen} value={draft.notes} onChange={e=>setDraft(d=>({...d,notes:e.target.value}))}/></label><p>Add context about the room photos or anything the owner should know.</p></>:
    draft.step==='supplies'?<RoomSupplyCheck rooms={included} jobId={current.job.id} startedAt={current.startedAt} disabled={frozen}/>:
    draft.step==='maintenance'?<RoomMaintenanceCheck rooms={included} job={current.job} user={user} integration={integration} startedAt={current.startedAt} disabled={frozen}/>:
    <fieldset className={styles.guestReview} disabled={frozen}><legend>Condition after checkout</legend><p>Rate the condition the guest left the property in. This review stays in Bloom.</p><GuestStars value={draft.rating} disabled={frozen} onChange={rating=>setDraft(d=>({...d,rating:Math.ceil(rating)}))}/><p>1 · Poor condition &nbsp; 5 · Excellent condition</p><GuestComment job={current.job} user={user} integration={integration} disabled={frozen} onPendingChange={setUploading} value={draft.comment} onChange={comment=>setDraft(d=>({...d,comment}))}/></fieldset>}
    {error!=null&&<ErrorNotice error={error}/>}
    <ReferenceButton onClick={()=>setReferenceOpen(true)}/>
   </div>
   <footer className={styles.footer}>
    {hint&&<p role="alert" className={styles.inlineHint}>{hint}</p>}
    {draft.step==='guest'&&outstanding&&teammate&&!handoffMessage&&<p role="status" className={styles.inlineHint}>{current.completion.photos?'Some checks are still missing.':'Some room photos are still missing.'} Your teammate will be notified to add them and submit.</p>}
    {handoffMessage&&<p role="status" className={styles.inlineNote}>{handoffMessage}</p>}
    <button type="button" className="bloom-button secondary" disabled={busy||!!draft.pending||uploading} onClick={()=>{setError(undefined);setHint('');if(index===0)onBack();else setDraft(d=>({...d,step:steps[index-1]}));}}>Back</button>
    {draft.step==='guest'&&outstanding&&teammate?<button type="button" className="bloom-button" disabled={busy||uploading||!!handoffMessage||current.job.reviewRequired} onClick={()=>void askTeammate()}>{busy?'Sending…':handoffMessage?'Teammate notified':'Ask teammate to finish'}</button>:draft.step==='guest'?<button type="button" className="bloom-button" disabled={busy||uploading||!draft.rating||current.job.reviewRequired} onClick={()=>void finish()}>{busy?'Submitting…':draft.pending?'Retry completion':'Complete cleaning'}</button>:<button type="button" className="bloom-button" disabled={frozen||uploading} onClick={()=>void next()}><ButtonContent icon={<Icon name="arrow-right"/>}>Continue</ButtonContent></button>}
   </footer>
  </section></div>
  {referenceOpen&&<JobReferenceDialog propertyName={current.job.propertyName} step={referenceStep} onStep={setReferenceStep} onClose={()=>setReferenceOpen(false)} access={<RoomAccess rooms={included}/>} supplies={<><h3><ReferenceIcon supplies/>Supplies at this property</h3><JobSupplies jobId={current.job.id} compact={false}/></>} maintenance={<><h3>Maintenance</h3><p>Last reported condition · Unreported items have not been checked.</p><JobMaintenance jobId={current.job.id}/></>}/>}
  {detailsOpen&&<JobDetailsDialog job={current.job} user={user} started team={team} now={Date.now()} onClose={()=>setDetailsOpen(false)}/>}
 </Modal>;
}

/** Each unit keeps its own entry details, so access info is chosen per room. */
export function RoomAccess({rooms}:{rooms:RoomVisit['rooms']}){
 const [room,setRoom]=useState(rooms[0]?.propertyId??'');
 return <div className={roomStyles.houseItems}><h3><ReferenceIcon/>Access info</h3>{rooms.length>1&&<RoomPicker rooms={rooms} value={room} onChange={setRoom}/>}{room?<AccessInfo key={room} propertyId={room}/>:<p>No rooms are included in this visit.</p>}</div>;
}
