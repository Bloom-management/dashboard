'use client';
import {GuestComment} from './guest-comment';
import {ButtonContent} from './button-content';
import {SupplyNotes,type SupplyNotesHandle} from './job-notes';
import {CleaningHandoff} from './cleaning-handoff';
import {AccessInfo} from './access-info';
import {JobDetailsDialog,JobReferenceDialog,ReferenceButton,ReferenceIcon,startCountdown} from './job-reference';
import {CompletionReportContent} from './cleaning-report';
import {useJobTeam} from './cleaner-identity';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CleanerJob, CompletionResult, JobJourney, SessionUser, SupplyLevel } from '../../contracts';
import type { BloomIntegration } from './integration';
import { request, ApiError } from './api';
import { ErrorNotice, Loading, Modal, useResource, Icon} from './primitives';
import { GuestStars } from './guest-stars';
import { MaintenanceGrid, MaintenanceCheck, SupplyReferenceGrid } from './maintenance';
import { Photos } from './photos';
import { completionInput, supplyLevels, uncertainCompletion, type JourneyDraft } from './journey-draft';
import { mayWithdraw } from './job-policy';
import styles from './cleaner-journey.module.css';

export function CleanerJourney({ job, user, integration, onClose, onUpdate }: {job: CleanerJob;user:SessionUser;integration:BloomIntegration;onClose:()=>void;onUpdate:(job:CleanerJob)=>void}) {
  const load=useCallback((signal:AbortSignal)=>request<JobJourney>(`/jobs/${job.id}/journey`,{signal}),[job.id]);
  const resource=useResource(load,true);
  const team=useJobTeam(job.id,job.version);
  const hasTeammate=(team.data?.length??0)>1;
  // Supplies tapped in this session; only these play the fill animation on touch screens.
  const [picked,setPicked]=useState<Set<string>>(()=>new Set());
  const supplyNotes=useRef<SupplyNotesHandle|null>(null);
  const [notePreviewTarget,setNotePreviewTarget]=useState<HTMLDivElement|null>(null);
  const [notePhotoTarget,setNotePhotoTarget]=useState<HTMLDivElement|null>(null);
  const [noteUploading,setNoteUploading]=useState(false);
  const [draft,setDraft]=useState<JourneyDraft>({step:'progress',answers:{},notes:'',version:0});
  const [hydrated,setHydrated]=useState(false);
  const [coverage,setCoverage]=useState(false);
  const [detailsOpen,setDetailsOpen]=useState(false);
  const [referenceStep,setReferenceStep]=useState(0);
  const [referenceOpen,setReferenceOpen]=useState(false);
  const [withdrawOpen,setWithdrawOpen]=useState(false);
  const [withdrawComment,setWithdrawComment]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<unknown>();
  const [storageError,setStorageError]=useState(false);
  const [result,setResult]=useState<CompletionResult>();
  const stepHeading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{stepHeading.current?.focus({preventScroll:true});},[draft.step]);
  const locked=useRef(false);
  const actionKey=useRef<{action:string;key:string}|undefined>(undefined);
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const storageKey=`bloom-journey:${user.id}:${job.id}`;
  useEffect(()=>{try{const raw=localStorage.getItem(storageKey);if(raw){const saved=JSON.parse(raw);if(saved && ['progress','photos','supplies','maintenance','guest'].includes(saved.step)&&typeof saved.notes==='string'&&saved.answers&&typeof saved.version==='number')setDraft(saved);}}catch{setStorageError(true);}setHydrated(true);},[storageKey]);
  useEffect(()=>{if(hydrated&&!result)try{localStorage.setItem(storageKey,JSON.stringify(draft));}catch{setStorageError(true);}},[draft,hydrated,result,storageKey]);
  useEffect(()=>{const timer=setInterval(()=>{setNow(Date.now());resource.reload();},30000);return()=>clearInterval(timer);},[resource.reload]);
  const data=resource.data;
  const config=data?.config;
  const current=data?.job ?? job;
  const pending=!!draft.pending;
  const accessLost=error instanceof ApiError && ['UNAUTHENTICATED','FORBIDDEN','NOT_FOUND'].includes(error.code);
  const paused=!!data?.job.reviewRequired;
  const frozen=busy||pending||!!draft.pendingHandoff||paused||accessLost||!hydrated||!data||!!resource.error;
  async function action(action:'start'|'withdraw') {
    if(locked.current)return;if(action==='withdraw'&&(current.management==='private'||current.canDecline)&&!withdrawComment.trim()){setWithdrawOpen(true);return;}locked.current=true;setBusy(true);setError(undefined);
    if(actionKey.current?.action!==action)actionKey.current={action,key:crypto.randomUUID()};
    try {if(action==='start'){await request<JobJourney>(`/jobs/${job.id}/start`,{body:{},key:actionKey.current.key});resource.reload();}
    else {const updated=await request<CleanerJob>(`/jobs/${job.id}/${current.canDecline?'decline':'withdraw'}`,{body:(current.management==='private'||current.canDecline)?{comment:withdrawComment.trim()}:{},key:actionKey.current.key});onUpdate(updated);}actionKey.current=undefined;
    }catch(failure){setError(failure);}finally{locked.current=false;setBusy(false);}
  }
  async function complete() {
    if(locked.current||!config||draft.pendingHandoff)return;
    const input=draft.pending?.input ?? completionInput(config.version,config.supplies.map(s=>s.id),draft.answers,draft.notes,draft.maintenance??{},draft.guestReview);
    if(!input||(!draft.pending&&!input.guestReview))return;
    const submission=draft.pending ?? {key:crypto.randomUUID(),input:{...input,handoffRevision:draft.handoffRevision??0}};
    const next={...draft,pending:submission};
    // Persist the immutable operation BEFORE sending; a lost response must replay this key.
    try{localStorage.setItem(storageKey,JSON.stringify(next));}catch{setStorageError(true);return;}
    setDraft(next);locked.current=true;setBusy(true);setError(undefined);
    try{const response=await request<CompletionResult>(`/jobs/${job.id}/complete`,{body:submission.input,key:submission.key});setResult(response);try{localStorage.removeItem(storageKey);localStorage.removeItem(`${storageKey}:before-handoff`);}catch{setStorageError(true);}onUpdate(response.job);}
    catch(failure){setError(failure);if(failure instanceof ApiError&&!uncertainCompletion(failure.code)){setDraft(value=>({...value,pending:undefined}));resource.reload();}}
    finally{locked.current=false;setBusy(false);}
  }
  const {beforeReminder,label:startCountdownLabel}=startCountdown(current,now);
  const receipt=result?.receipt ?? data?.receipt;
  const maintenanceReady=!!config && !!completionInput(config.version,config.supplies.map(s=>s.id),draft.answers,draft.notes,draft.maintenance??{});
  const answersReady=!!config && !!completionInput(config.version,config.supplies.map(s=>s.id),draft.answers,draft.notes);
  return <Modal className={`detail-card bloom-job-frame bloom-job-surface ${styles.dialog}`} title={`${job.propertyName} cleaning`} onClose={onClose}>
    <div className={styles.layout}><section className={styles.task}><p className={styles.factsEyebrow}>{current.management==='private'?'Your cleaning team':'Bloom Cleaning'} · Paid by {current.payerName??'Bloom'}</p>

      {(receipt || current.status==='completed')?<>
        <CompletionReportContent report={{jobId:job.id,propertyName:job.propertyName,date:job.checkoutDate,receipt:receipt??null}} onClose={onClose} details={<button type="button" className={`bloom-button secondary ${styles.detailsButton}`} onClick={()=>setDetailsOpen(true)}>Job details and rates</button>}/>
      </>:<>
        <header data-modal-header className={styles.heading}><div className={styles.headingRow}><span className={styles.kicker}>{!data?.startedAt?'Assigned · Ready to start':draft.step==='progress'?'In progress':`Finish cleaning · Step ${draft.step==='photos'?1:draft.step==='supplies'?2:draft.step==='maintenance'?3:4} of 4`}</span><button type="button" className={`bloom-button secondary ${styles.detailsButton}`} aria-haspopup="dialog" onClick={()=>setDetailsOpen(true)}>Job details and rates</button></div><h1 ref={stepHeading} tabIndex={-1}>{!data?.startedAt?'You’re on this cleaning.':draft.step==='progress'?'Make it guest-ready.':draft.step==='photos'?'A clear photo of every room.':draft.step==='supplies'?'Leave the next cleaner ready.':draft.step==='maintenance'?'Check what needs attention.':'How did the guest leave the property?'}</h1><p>{!data?.startedAt?'Your slot is confirmed. Review the unit details, then start when you’re ready.':draft.step==='progress'?'Start cleaning opens your room photos and supplies checklist. The job stays in progress until you submit.':'Your team shares the same room photos. Either assigned cleaner can submit for everyone.'}</p>{data?.startedAt&&draft.step!=='progress'&&<CompletionSteps current={draft.step==='photos'?0:draft.step==='supplies'?1:draft.step==='maintenance'?2:3}/>}</header>
        <div className={styles.content}>
          {(!hydrated||resource.loading&&!data)&&<div className={styles.journeyLoading}><Loading/></div>}
          {!!resource.error&&<ErrorNotice error={resource.error} retry={resource.reload}/>}
          {data&&!config&&!resource.error&&<p role="alert" className={styles.attention}>This property needs its actual rooms and supplies configured by its owner or an admin before cleaning can start.</p>}
          {paused&&<p role="alert" className={styles.attention}>Booking changes need admin attention. Starting and completion are paused; your progress is kept.</p>}
          {storageError&&<p role="alert">Device storage is unavailable. Keep this window open. Completion requires storing its retry key safely; enable site storage before submitting.</p>}
          {!!error&&<ErrorNotice error={error}/>}
          {pending&&<p role="status" className={styles.attention}>Completion has not been confirmed. Your submitted answers are locked. Retry this same submission to check its result safely.</p>}
          {data?.startedAt&&config&&<>
            <div hidden={draft.step!=='photos'}><Photos job={current} user={user} integration={integration} rooms={config.rooms} onCoverage={setCoverage} locked={frozen}/><label className={styles.notes}>Cleaning notes (optional)<textarea maxLength={1500} value={draft.notes} disabled={frozen} onChange={event=>setDraft(value=>({...value,notes:event.target.value}))}/></label><p>Add context about the room photos or anything the owner should know.</p></div>
            {draft.step==='progress'&&<div className={styles.panel}><h2>When you’re finished</h2><ol><li>Photograph every required room.</li><li>Report the supplies you find.</li><li>Check maintenance and report issues.</li><li>Rate the guest, then complete the whole cleaning.</li></ol></div>}
            {draft.step==='supplies'&&<>
              {config.supplies.length===0&&<p>No supplies are configured for this job. Continue to maintenance after all room photos are ready.</p>}
              {config.supplies.map(supply=><fieldset className={styles.question} key={supply.id} disabled={frozen}><legend>{supply.name} level?</legend><p>{data.previousReports.find(r=>r.supplyId===supply.id)?`Last reported: ${supplyLevels[data.previousReports.find(r=>r.supplyId===supply.id)!.level]} · ${new Date(data.previousReports.find(r=>r.supplyId===supply.id)!.reportedAt).toLocaleString()}`:'Defaults to Full · Change the level if needed'}</p><div className={styles.choices}>{Object.entries(supplyLevels).map(([level,label])=><button type="button" key={level} aria-pressed={(draft.answers[supply.id]??'full')===level} data-picked={picked.has(supply.id)||undefined} onClick={()=>{setPicked(value=>new Set(value).add(supply.id));setDraft(value=>({...value,version:config.version,answers:{...value.answers,[supply.id]:level as SupplyLevel}}));}}><SupplyLevelIcon level={level as SupplyLevel}/><span>{label}</span></button>)}</div>{['low','empty','not_found'].includes(draft.answers[supply.id])&&<p className={styles.attention}>Needs attention · {supplyLevels[draft.answers[supply.id]]}</p>}</fieldset>)}<SupplyNotes controller={supplyNotes} job={current} user={user} integration={integration} disabled={frozen} onPendingChange={setNoteUploading}/>
            </>}
            {draft.step==='maintenance'&&<><MaintenanceCheck answers={draft.maintenance??{}} disabled={frozen} onChange={maintenance=>setDraft(value=>({...value,maintenance}))}/>
              <div className={styles.notes}><label htmlFor="maintenance-note-text">Anything that needs attention? <span>Optional</span></label><div className={styles.noteBox}><div ref={setNotePreviewTarget} className={styles.noteAttachments}/><textarea id="maintenance-note-text" maxLength={1500} value={draft.notes} disabled={frozen} onChange={event=>setDraft(value=>({...value,notes:event.target.value}))}/><div ref={setNotePhotoTarget} className={styles.noteCamera}/></div></div><Photos job={current} user={user} integration={integration} locked={frozen} noteContext="maintenance" pickerTarget={notePhotoTarget} previewTarget={notePreviewTarget} onPendingChange={setNoteUploading}/>
            </>}
            {draft.step==='guest'&&<fieldset className={styles.guestReview} disabled={frozen}><legend>Condition after checkout</legend><p>Rate the condition the guest left the property in. This review stays in Bloom.</p><GuestStars value={draft.guestReview?.rating??0} disabled={frozen} onChange={rating=>setDraft(value=>({...value,guestReview:{rating,comment:value.guestReview?.comment??''}}))}/><p>1 · Poor condition &nbsp; 5 · Excellent condition</p><GuestComment job={current} user={user} integration={integration} disabled={frozen} onPendingChange={setNoteUploading} value={draft.guestReview?.comment??''} onChange={comment=>setDraft(value=>({...value,guestReview:{rating:value.guestReview?.rating??0,comment}}))}/><p>Your notes and guest review are saved when you complete the cleaning or ask your teammate to finish.</p></fieldset>}
          </>}
          <ReferenceButton onClick={()=>setReferenceOpen(true)}/>
        </div>
{!receipt&&current.status==='open'&&hydrated&&<CleaningHandoff jobId={job.id} userId={user.id} configVersion={config?.version??0} hasTeammate={hasTeammate} started={!!data?.startedAt} disabled={busy||noteUploading||pending||paused||accessLost||!config} draft={draft} setDraft={setDraft} onBusy={setBusy}/>}
        <footer className={styles.footer}>
          {noteUploading&&<p role="status">Wait for note photos to finish uploading before continuing.</p>}
          {data?.startedAt&&config&&!coverage&&!pending&&(draft.step==='photos'||draft.step==='guest')&&<p role={hasTeammate?'status':'alert'} className={styles.inlineHint}>{hasTeammate?'Some room photos are still missing. Continue, then ask your teammate to finish — they’ll be notified what’s needed.':'Please upload a photo for every room to continue.'}</p>}
          {!data?.startedAt?<button className="bloom-button" disabled={!config||frozen||now<Date.parse(job.startAt)} onClick={()=>action('start')}>{busy?'Starting…':now<Date.parse(job.startAt)?`${beforeReminder?'Start reminder in':'Start in'} ${startCountdownLabel}`:<ButtonContent icon={<Icon name="arrow-right"/>}>Start cleaning</ButtonContent>}</button>:draft.step==='progress'?<button className="bloom-button" disabled={busy||paused||accessLost} onClick={()=>setDraft(value=>({...value,step:pending?'guest':'photos'}))}>{pending?'Review pending completion':<ButtonContent icon={<Icon name="arrow-right"/>}>Start cleaning</ButtonContent>}</button>:<>
            <button className="bloom-button secondary" disabled={busy||noteUploading} onClick={()=>setDraft(value=>({...value,step:draft.step==='guest'?'maintenance':draft.step==='maintenance'?'supplies':draft.step==='supplies'?'photos':'progress'}))}>Back</button>
            {draft.step==='photos'?<button className="bloom-button" disabled={(!coverage&&!pending&&!hasTeammate)||busy||paused} onClick={()=>setDraft(value=>({...value,step:'supplies'}))}><ButtonContent icon={<Icon name="arrow-right"/>}>Continue</ButtonContent></button>:draft.step==='supplies'?<button className="bloom-button" disabled={busy||noteUploading||paused||(!pending&&!answersReady)} onClick={async()=>{setBusy(true);try{if(await supplyNotes.current?.save())setDraft(value=>({...value,step:'maintenance',reviewed:[...new Set([...(value.reviewed??[]),'supplies' as const])]}));}finally{setBusy(false);}}}><ButtonContent icon={<Icon name="arrow-right"/>}>Continue</ButtonContent></button>:draft.step==='maintenance'?<button className="bloom-button" disabled={busy||noteUploading||paused||(!pending&&!maintenanceReady)} onClick={()=>setDraft(value=>({...value,step:'guest',reviewed:[...new Set([...(value.reviewed??[]),'maintenance' as const])]}))}><ButtonContent icon={<Icon name="arrow-right"/>}>Continue</ButtonContent></button>:<button className="bloom-button" disabled={busy||noteUploading||!!draft.pendingHandoff||paused||accessLost||(!pending&&(!coverage||!maintenanceReady||!draft.guestReview||!completionInput(config?.version??0,config?.supplies.map(s=>s.id)??[],draft.answers,draft.notes,draft.maintenance??{},draft.guestReview)))} onClick={complete}>{busy?'Confirming…':pending?'Retry completion':'Complete cleaning'}</button>}
          </>}
          {current.status==='open'&&(current.canDecline||current.management==='private'||current.withdrawalDeadlineExempt||!data?.startedAt||draft.step==='progress')&&<div className={styles.withdrawAction}>{current.withdrawalDeadlineExempt&&<p>Local practice job · You can withdraw without the six-hour deadline.</p>}{mayWithdraw(current,now)?<button className="bloom-button secondary" disabled={current.canDecline?busy||pending||accessLost:frozen} onClick={()=>(current.management==='private'||current.canDecline)?setWithdrawOpen(true):action('withdraw')}>{current.canDecline?'Decline job':'Withdraw'}</button>:<p>For reassignment, contact your admin. Self-withdrawal closes six hours before start.</p>}</div>}
        {withdrawOpen&&<div className={styles.notes}><label htmlFor="private-withdraw-comment">Reason for declining<textarea id="private-withdraw-comment" required maxLength={1000} value={withdrawComment} disabled={busy} onChange={event=>{setWithdrawComment(event.target.value);actionKey.current=undefined;}}/></label><button className="bloom-button secondary" disabled={busy} onClick={()=>setWithdrawOpen(false)}>Keep assignment</button><button className="bloom-button" disabled={busy||!withdrawComment.trim()} onClick={()=>action('withdraw')}>Decline job</button></div>}</footer>
      </>}
    </section></div>
    {referenceOpen&&<JobReferenceDialog propertyName={current.propertyName} step={referenceStep} onStep={setReferenceStep} onClose={()=>setReferenceOpen(false)} access={<><h3><ReferenceIcon/>Access info</h3><AccessInfo propertyId={current.propertyId}/></>} supplies={<><h3><ReferenceIcon supplies/>Supplies at this property</h3>{config?<SupplyReferenceGrid supplies={config.supplies} reports={data?.previousReports}/>:<p>Supply configuration is unavailable.</p>}</>} maintenance={<MaintenanceGrid reports={data?.previousMaintenance}/>}/>}
    {detailsOpen&&<JobDetailsDialog job={current} user={user} started={!!data?.startedAt} team={team} now={now} onClose={()=>setDetailsOpen(false)}/>}
  </Modal>;
}
export function SupplyLevelIcon({level}:{level:SupplyLevel}) {
  if(level==='not_found')return <span className={styles.supplyUnknown} aria-hidden="true">?</span>;
  const height={full:24,moderate:14,low:5,empty:0}[level];
  return <svg className={styles.supplyIcon} width="28" height="36" viewBox="0 0 28 36" fill="none" aria-hidden="true"><rect x="2" y="1" width="24" height="34" rx="5" stroke="currentColor" strokeWidth="1.5"/>{height>0&&<svg x="6" y={31-height} width="16" height={height} viewBox={`0 0 16 ${height}`} overflow="hidden"><rect width="16" height={height} rx="1" fill="currentColor" className={styles.liquidStill}/><path className={styles.liquidWave} d={`M -16 2 Q -12 -1 -8 2 T 0 2 T 8 2 T 16 2 T 24 2 T 32 2 V ${height+4} H -16 Z`} fill="currentColor"/></svg>}</svg>;
}

export function CompletionSteps({current}:{current:0|1|2|3|4}) {
  return <ol className={styles.completionSteps} aria-label="Cleaning completion progress">{['Room photos','Supplies check','Maintenance','Condition after checkout','Done'].map((label,index)=><li key={label} aria-current={index===current?'step':undefined}><span className={styles.stepCircle} aria-hidden="true">{index<current?'✓':index+1}</span><span>{label}{index<current&&<span className="bloom-sr-only"> — completed</span>}</span></li>)}</ol>;
}

