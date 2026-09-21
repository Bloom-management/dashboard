'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CleanerJob, CompletionResult, JobJourney, SessionUser, SupplyLevel } from '../../contracts';
import type { BloomIntegration } from './integration';
import { request, ApiError } from './api';
import { ErrorNotice, Loading, Modal, useResource } from './primitives';
import { MaintenanceGrid, MaintenanceCheck, SupplyReferenceGrid } from './maintenance';
import { Photos } from './photos';
import { formatDate, formatTime, money } from './dates';
import { completionInput, supplyLevels, uncertainCompletion, type JourneyDraft } from './journey-draft';
import { mayWithdraw } from './job-policy';
import styles from './cleaner-journey.module.css';

export function CleanerJourney({ job, user, integration, onClose, onUpdate }: {job: CleanerJob;user:SessionUser;integration:BloomIntegration;onClose:()=>void;onUpdate:(job:CleanerJob)=>void}) {
  const load=useCallback((signal:AbortSignal)=>request<JobJourney>(`/jobs/${job.id}/journey`,{signal}),[job.id]);
  const resource=useResource(load,true);
  const [draft,setDraft]=useState<JourneyDraft>({step:'progress',answers:{},notes:'',version:0});
  const [hydrated,setHydrated]=useState(false);
  const [coverage,setCoverage]=useState(false);
  const [detailsOpen,setDetailsOpen]=useState(false);
  const [referenceStep,setReferenceStep]=useState(0);
  const [referenceOpen,setReferenceOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<unknown>();
  const [storageError,setStorageError]=useState(false);
  const [result,setResult]=useState<CompletionResult>();
  const locked=useRef(false);
  const actionKey=useRef<{action:string;key:string}|undefined>(undefined);
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const storageKey=`bloom-journey:${user.id}:${job.id}`;
  useEffect(()=>{try{const raw=localStorage.getItem(storageKey);if(raw){const saved=JSON.parse(raw);if(saved && ['progress','photos','supplies','maintenance'].includes(saved.step)&&typeof saved.notes==='string'&&saved.answers&&typeof saved.version==='number')setDraft(saved);}}catch{setStorageError(true);}setHydrated(true);},[storageKey]);
  useEffect(()=>{if(hydrated&&!result)try{localStorage.setItem(storageKey,JSON.stringify(draft));}catch{setStorageError(true);}},[draft,hydrated,result,storageKey]);
  useEffect(()=>{const timer=setInterval(()=>{setNow(Date.now());resource.reload();},30000);return()=>clearInterval(timer);},[resource.reload]);
  const data=resource.data;
  const config=data?.config;
  const current=data?.job ?? job;
  const pending=!!draft.pending;
  const accessLost=error instanceof ApiError && ['UNAUTHENTICATED','FORBIDDEN','NOT_FOUND'].includes(error.code);
  const paused=!!data?.job.reviewRequired;
  const frozen=busy||pending||paused||accessLost||!hydrated||!data||!!resource.error;
  async function action(action:'start'|'withdraw') {
    if(locked.current)return;locked.current=true;setBusy(true);setError(undefined);
    if(actionKey.current?.action!==action)actionKey.current={action,key:crypto.randomUUID()};
    try {if(action==='start'){await request<JobJourney>(`/jobs/${job.id}/start`,{body:{},key:actionKey.current.key});resource.reload();}
    else {const updated=await request<CleanerJob>(`/jobs/${job.id}/withdraw`,{body:{},key:actionKey.current.key});onUpdate(updated);}actionKey.current=undefined;
    }catch(failure){setError(failure);}finally{locked.current=false;setBusy(false);}
  }
  async function complete() {
    if(locked.current||!config)return;
    const input=draft.pending?.input ?? completionInput(config.version,config.supplies.map(s=>s.id),draft.answers,draft.notes,draft.maintenance??{});
    if(!input)return;
    const submission=draft.pending ?? {key:crypto.randomUUID(),input};
    const next={...draft,pending:submission};
    // Persist the immutable operation BEFORE sending; a lost response must replay this key.
    try{localStorage.setItem(storageKey,JSON.stringify(next));}catch{setStorageError(true);return;}
    setDraft(next);locked.current=true;setBusy(true);setError(undefined);
    try{const response=await request<CompletionResult>(`/jobs/${job.id}/complete`,{body:submission.input,key:submission.key});setResult(response);try{localStorage.removeItem(storageKey);}catch{setStorageError(true);}onUpdate(response.job);}
    catch(failure){setError(failure);if(failure instanceof ApiError&&!uncertainCompletion(failure.code)){setDraft(value=>({...value,pending:undefined}));resource.reload();}}
    finally{locked.current=false;setBusy(false);}
  }
  const earlyReminderAt=Date.parse(current.startAt)-3600000;
  const beforeReminder=now<earlyReminderAt;
  const countdownSeconds=Math.max(0,Math.ceil(((beforeReminder?earlyReminderAt:Date.parse(current.startAt))-now)/1000));
  const startCountdown=`${Math.floor(countdownSeconds/3600)}h ${String(Math.floor(countdownSeconds%3600/60)).padStart(2,'0')}m ${String(countdownSeconds%60).padStart(2,'0')}s`;
  const receipt=result?.receipt ?? data?.receipt;
  const maintenanceReady=!!config && !!completionInput(config.version,config.supplies.map(s=>s.id),draft.answers,draft.notes,draft.maintenance??{});
  const answersReady=!!config && !!completionInput(config.version,config.supplies.map(s=>s.id),draft.answers,draft.notes);
  return <Modal className={`detail-card bloom-job-surface ${styles.dialog}`} title={`${job.propertyName} cleaning`} onClose={onClose}>
    <div className={styles.layout}><section className={styles.task}>

      {(receipt || current.status==='completed')?<>
        <header className={styles.heading}><div className={styles.headingRow}><span className={styles.kicker}>Completed</span><button type="button" className={`bloom-button secondary ${styles.detailsButton}`} aria-haspopup="dialog" onClick={()=>setDetailsOpen(true)}>Job details and rates</button></div><h1>Cleaning complete.</h1><p>Completed for the whole job. No admin approval is needed.</p>{receipt?.maintenance&&<CompletionSteps current={3}/>}</header>
        <div className={styles.content}><p>{formatDate(job.checkoutDate)} · {job.propertyName}</p><p>{receipt?.maintenance?'Your supply and maintenance reports are saved with the completion.':receipt?'Your supply report is saved with the completion.':'This cleaning was completed before room and supply reports were introduced.'}</p>{receipt&&<section aria-label="Reported supplies"><h3>Supplies</h3>{receipt.reports.length?<div className={styles.receiptSupplies}>{receipt.reports.map(report=><article key={report.supplyId} className={styles.receiptSupply} data-attention={['low','empty','not_found'].includes(report.level)||undefined}><SupplyLevelIcon level={report.level}/><strong>{report.name}</strong><span>{supplyLevels[report.level]}</span></article>)}</div>:<p>No supplies were configured for this cleaning.</p>}</section>}<p>{receipt?.notes}</p>{receipt?.maintenance&&<MaintenanceGrid reports={receipt.maintenance}/>}<button className="bloom-button" onClick={onClose}>Back to calendar</button></div>
      </>:<>
        <header className={styles.heading}><div className={styles.headingRow}><span className={styles.kicker}>{!data?.startedAt?'Assigned · Ready to start':draft.step==='progress'?'In progress':`Finish cleaning · Step ${draft.step==='photos'?1:draft.step==='supplies'?2:3} of 3`}</span><button type="button" className={`bloom-button secondary ${styles.detailsButton}`} aria-haspopup="dialog" onClick={()=>setDetailsOpen(true)}>Job details and rates</button></div><h1>{!data?.startedAt?'You’re on this cleaning.':draft.step==='progress'?'Make it guest-ready.':draft.step==='photos'?'A clear photo of every room.':draft.step==='supplies'?'Leave the next cleaner ready.':'Check what needs attention.'}</h1><p>{!data?.startedAt?'Your slot is confirmed. Review the unit details, then start when you’re ready.':draft.step==='progress'?'Start cleaning opens your room photos and supplies checklist. The job stays in progress until you submit.':'Your team shares the same room photos. Either assigned cleaner can submit for everyone.'}</p>{data?.startedAt&&draft.step!=='progress'&&<CompletionSteps current={draft.step==='photos'?0:draft.step==='supplies'?1:2}/>}</header>
        <div className={styles.content}>
          {(!hydrated||resource.loading&&!data)&&<div className={styles.journeyLoading}><Loading/></div>}
          {!!resource.error&&<ErrorNotice error={resource.error} retry={resource.reload}/>}
          {user.role==='admin'&&<p className={styles.panel}>Cleaning as yourself · Admin access stays active.</p>}
          {data&&!config&&!resource.error&&<p role="alert" className={styles.attention}>This property needs its actual rooms and supplies configured by its owner or an admin before cleaning can start.</p>}
          {paused&&<p role="alert" className={styles.attention}>Booking changes need admin attention. Starting and completion are paused; your progress is kept.</p>}
          {storageError&&<p role="alert">Device storage is unavailable. Keep this window open. Completion requires storing its retry key safely; enable site storage before submitting.</p>}
          {!!error&&<ErrorNotice error={error}/>}
          {pending&&<p role="status" className={styles.attention}>Completion has not been confirmed. Your submitted answers are locked. Retry this same submission to check its result safely.</p>}
          {data?.startedAt&&config&&<>
            <div hidden={draft.step!=='photos'}><Photos job={current} user={user} integration={integration} rooms={config.rooms} onCoverage={setCoverage} locked={frozen}/></div>
            {draft.step==='progress'&&<div className={styles.panel}><h2>When you’re finished</h2><ol><li>Photograph every required room.</li><li>Report the supplies you find.</li><li>Check maintenance and report issues.</li><li>Complete the whole cleaning.</li></ol></div>}
            {draft.step==='supplies'&&<><p>{coverage?'All required rooms have ready photos.':'Check room coverage before submitting.'}</p><button className="bloom-button secondary" disabled={busy} onClick={()=>setDraft(value=>({...value,step:'photos'}))}>Review photos</button>
              {config.supplies.length===0&&<p>No supplies are configured for this job. Continue to maintenance after all room photos are ready.</p>}
              {config.supplies.map(supply=><fieldset className={styles.question} key={supply.id} disabled={frozen}><legend>{supply.name} level?</legend><p>{data.previousReports.find(r=>r.supplyId===supply.id)?`Last reported: ${supplyLevels[data.previousReports.find(r=>r.supplyId===supply.id)!.level]} · ${new Date(data.previousReports.find(r=>r.supplyId===supply.id)!.reportedAt).toLocaleString()}`:'Defaults to Full · Change the level if needed'}</p><div className={styles.choices}>{Object.entries(supplyLevels).map(([level,label])=><button type="button" key={level} aria-pressed={(draft.answers[supply.id]??'full')===level} onClick={()=>setDraft(value=>({...value,version:config.version,answers:{...value.answers,[supply.id]:level as SupplyLevel}}))}><SupplyLevelIcon level={level as SupplyLevel}/><span>{label}</span></button>)}</div>{['low','empty','not_found'].includes(draft.answers[supply.id])&&<p className={styles.attention}>Needs attention · {supplyLevels[draft.answers[supply.id]]}</p>}</fieldset>)}
            </>}
            {draft.step==='maintenance'&&<><p>Choose No issue or Needs attention. Unselected items are not applicable. Click a selected choice again to clear it. Add a short note for anything that needs attention.</p><MaintenanceCheck answers={draft.maintenance??{}} disabled={frozen} onChange={maintenance=>setDraft(value=>({...value,maintenance}))}/>
              <label className={styles.notes}>Anything that needs attention? <span>Optional</span><textarea maxLength={1500} value={draft.notes} disabled={frozen} onChange={event=>setDraft(value=>({...value,notes:event.target.value}))}/></label>
            </>}
          </>}
          <button type="button" className={styles.referenceButton} aria-haspopup="dialog" onClick={()=>setReferenceOpen(true)}><ReferenceIcon/><span>Property instructions and supplies</span><span aria-hidden="true">↗</span></button>
        </div>
        <footer className={styles.footer}>
          {!data?.startedAt?<button className="bloom-button" disabled={!config||frozen||now<Date.parse(job.startAt)} onClick={()=>action('start')}>{busy?'Starting…':now<Date.parse(job.startAt)?`${beforeReminder?'Start reminder in':'Start in'} ${startCountdown}`:'Start cleaning →'}</button>:draft.step==='progress'?<button className="bloom-button" disabled={busy||paused||accessLost} onClick={()=>setDraft(value=>({...value,step:pending?'maintenance':'photos'}))}>{pending?'Review pending completion':'Start cleaning →'}</button>:<>
            <button className="bloom-button secondary" disabled={busy} onClick={()=>setDraft(value=>({...value,step:draft.step==='maintenance'?'supplies':draft.step==='supplies'?'photos':'progress'}))}>Back</button>
            {draft.step==='photos'?<button className="bloom-button" disabled={(!coverage&&!pending)||busy||paused} onClick={()=>setDraft(value=>({...value,step:'supplies'}))}>Continue to supplies →</button>:draft.step==='supplies'?<button className="bloom-button" disabled={busy||paused||(!pending&&!answersReady)} onClick={()=>setDraft(value=>({...value,step:'maintenance'}))}>Continue to maintenance →</button>:<button className="bloom-button" disabled={busy||paused||accessLost||(!pending&&(!coverage||!maintenanceReady))} onClick={complete}>{busy?'Confirming…':pending?'Retry completion':'Complete cleaning'}</button>}
          </>}
          {current.status==='open'&&(current.withdrawalDeadlineExempt||!data?.startedAt||draft.step==='progress')&&<div className={styles.withdrawAction}>{current.withdrawalDeadlineExempt&&<p>Local practice job · You can withdraw without the six-hour deadline.</p>}{mayWithdraw(current,now)?<button className="bloom-button secondary" disabled={frozen} onClick={()=>action('withdraw')}>Withdraw from cleaning</button>:<p>For reassignment, contact your admin. Self-withdrawal closes six hours before start.</p>}</div>}
        </footer>
      </>}
    </section></div>
    {referenceOpen&&<Modal className={`detail-card ${styles.detailsDialog} ${styles.referenceDialog}`} title="Property instructions and supplies" onClose={()=>setReferenceOpen(false)}><h2>Property instructions and supplies</h2><p className={styles.referenceProperty}>{current.propertyName}</p><div className="owner-detail-navigation"><div className="view-toggle" role="group" aria-label="Property reference sections">{['Instructions','Supplies','Maintenance'].map((label,index)=><button type="button" className={`vt-btn${referenceStep===index?' active':''}`} aria-pressed={referenceStep===index} key={label} onClick={()=>setReferenceStep(index)}>{label}</button>)}</div><div className="bloom-actions"><button type="button" className="bloom-button secondary" aria-label="Previous reference section" onClick={()=>setReferenceStep((referenceStep+2)%3)}>‹</button><button type="button" className="bloom-button secondary" aria-label="Next reference section" onClick={()=>setReferenceStep((referenceStep+1)%3)}>›</button></div></div><section hidden={referenceStep!==0}><h3><ReferenceIcon/>Property instructions</h3><JourneyInstructions job={current} integration={integration}/></section><section hidden={referenceStep!==1}><h3><ReferenceIcon supplies/>Supplies at this property</h3>{config?<SupplyReferenceGrid supplies={config.supplies} reports={data?.previousReports}/>:<p>Supply configuration is unavailable.</p>}</section><section hidden={referenceStep!==2}><MaintenanceGrid reports={data?.previousMaintenance}/></section></Modal>}
    {detailsOpen&&<Modal className={`detail-card ${styles.detailsDialog}`} title="Job details and rates" onClose={()=>setDetailsOpen(false)}><div className={styles.jobFacts}>
      <p className={styles.factsEyebrow}>Your cleaning</p>
      <h2>{current.propertyName}</h2>
      {!data?.startedAt&&current.status==='open'&&countdownSeconds>0&&<p className={styles.startCountdown}>{beforeReminder?'Start reminder in':'Start in'} {startCountdown}</p>}
      <p className={styles.factsDate}>{new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(new Date(`${current.checkoutDate}T12:00:00Z`))}</p>
      <div className={styles.timeWindow}><div><strong>{formatTime(current.startAt,current.timezone)}</strong><span>Start</span></div><div className={styles.timeLine} aria-hidden="true"/><div><strong>{formatTime(current.endAt,current.timezone)}</strong><span>Finish</span></div></div>
      <div className={styles.teamSection}><p>{current.timezone}</p>
        <div className={styles.teamMember}><span className={styles.avatar} aria-hidden="true">Y</span><div><strong>You</strong><p>Assigned to this cleaning</p></div></div>
        <div className={styles.teamMember}><span className={`${styles.avatar} ${current.activeCleanerCount<2?styles.openSlot:''}`} aria-hidden="true">{current.activeCleanerCount<2?'+':'✓'}</span><div><strong>{current.activeCleanerCount>=2?'Second cleaner assigned':current.status==='open'?'Second slot available':'Second slot unfilled'}</strong><p>{current.activeCleanerCount>=2?'Assigned to this cleaning':current.status==='open'?'Another eligible cleaner can join':'No second cleaner assigned'}</p></div></div>
      </div>
      <div className={styles.rateSection}><div><span>Your payout:</span><strong>{current.status==='completed'?(current.myCompletedPayCents===null?'Unavailable':money(current.myCompletedPayCents)):money(current.activeCleanerCount>=2?current.sharedRateCents:current.soloRateCents)}</strong></div>{current.status==='open'&&<p>Provisional until completion.</p>}</div>

    </div></Modal>}
  </Modal>;
}
function JourneyInstructions({job,integration}:{job:CleanerJob;integration:BloomIntegration}) {
  const load=useCallback((signal:AbortSignal)=>integration.getInstructions?integration.getInstructions(job.id,signal,job.propertyId):Promise.resolve(null),[integration,job.id,job.propertyId]);
  const data=useResource(load);
  return data.loading?<Loading/>:data.error?<ErrorNotice error={data.error} retry={data.reload}/>:<p className="bloom-prewrap">{data.data?.instructions || 'No instructions provided.'}</p>;
}

function SupplyLevelIcon({level}:{level:SupplyLevel}) {
  if(level==='not_found')return <span className={styles.supplyUnknown} aria-hidden="true">?</span>;
  const height={full:24,moderate:14,low:5,empty:0}[level];
  return <svg className={styles.supplyIcon} width="28" height="36" viewBox="0 0 28 36" fill="none" aria-hidden="true"><rect x="2" y="1" width="24" height="34" rx="5" stroke="currentColor" strokeWidth="1.5"/>{height>0&&<svg x="6" y={31-height} width="16" height={height} viewBox={`0 0 16 ${height}`} overflow="hidden"><rect width="16" height={height} rx="1" fill="currentColor" className={styles.liquidStill}/><path className={styles.liquidWave} d={`M -16 2 Q -12 -1 -8 2 T 0 2 T 8 2 T 16 2 T 24 2 T 32 2 V ${height+4} H -16 Z`} fill="currentColor"/></svg>}</svg>;
}

function CompletionSteps({current}:{current:0|1|2|3}) {
  return <ol className={styles.completionSteps} aria-label="Cleaning completion progress">{['Room photos','Supplies check','Maintenance','Done'].map((label,index)=><li key={label} aria-current={index===current?'step':undefined}><span className={styles.stepCircle} aria-hidden="true">{index<current?'✓':index+1}</span><span>{label}{index<current&&<span className="bloom-sr-only"> — completed</span>}</span></li>)}</ol>;
}

function ReferenceIcon({supplies=false}:{supplies?:boolean}) {
 return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{supplies?<><path d="M9 3h6v4l3 4v10H6V11l3-4V3ZM9 7h6M6 14h12M15 3h4"/></>:<><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></>}</svg>;
}
