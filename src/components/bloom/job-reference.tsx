'use client';
import type {ReactNode} from 'react';
import type {CleanerJob,SessionUser} from '../../contracts';
import {SelectorPill} from './selector-pill';
import {CleanerAvatar,useJobTeam} from './cleaner-identity';
import {ErrorNotice,Loading,Modal, Icon} from './primitives';
import {formatTime,money} from './dates';
import styles from './cleaner-journey.module.css';

/** Shared by the whole-home journey and grouped room visits so both read identically. */
export function ReferenceIcon({supplies=false}:{supplies?:boolean}) {
 return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{supplies?<><path d="M9 3h6v4l3 4v10H6V11l3-4V3ZM9 7h6M6 14h12M15 3h4"/></>:<><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></>}</svg>;
}

export function ReferenceButton({onClick}:{onClick:()=>void}) {
 return <button type="button" className={styles.referenceButton} aria-haspopup="dialog" onClick={onClick}><ReferenceIcon/><span>Access info and supplies</span><Icon name="arrow-up-right" size={16}/></button>;
}

const referenceSections=['Access info','Supplies','Maintenance'] as const;

export function JobReferenceDialog({propertyName,step,onStep,onClose,access,supplies,maintenance}:{propertyName:string;step:number;onStep:(step:number)=>void;onClose:()=>void;access:ReactNode;supplies:ReactNode;maintenance:ReactNode}) {
 return <Modal className={`detail-card bloom-job-frame ${styles.detailsDialog} ${styles.referenceDialog}`} title="Access info and supplies" onClose={onClose}><div className={styles.referenceLayout}><header><h2>Access info and supplies</h2><p className={styles.referenceProperty}>{propertyName}</p><div className="owner-detail-navigation"><SelectorPill aria-label="Property reference sections">{referenceSections.map((label,index)=><button type="button" className={`vt-btn${step===index?' active':''}`} aria-pressed={step===index} key={label} onClick={()=>onStep(index)}>{label}</button>)}</SelectorPill><div className="bloom-actions"><button type="button" className="icon-btn" aria-label="Previous reference section" onClick={()=>onStep((step+2)%3)}><Icon name="left"/></button><button type="button" className="icon-btn" aria-label="Next reference section" onClick={()=>onStep((step+1)%3)}><Icon name="right"/></button></div></div></header><div className={styles.referenceScroll}><section hidden={step!==0}>{access}</section><section hidden={step!==1}>{supplies}</section><section hidden={step!==2}>{maintenance}</section></div></div></Modal>;
}

/** Countdown to the start reminder (one hour before) and then to the start itself. */
export function startCountdown(job:CleanerJob,now:number) {
 const earlyReminderAt=Date.parse(job.startAt)-3600000;
 const beforeReminder=now<earlyReminderAt;
 const seconds=Math.max(0,Math.ceil(((beforeReminder?earlyReminderAt:Date.parse(job.startAt))-now)/1000));
 const label=`${Math.floor(seconds/3600)}h ${String(Math.floor(seconds%3600/60)).padStart(2,'0')}m ${String(seconds%60).padStart(2,'0')}s`;
 return {beforeReminder,seconds,label};
}

export function JobDetailsDialog({job:current,user,started,team,now,onClose}:{job:CleanerJob;user:SessionUser;started:boolean;team:ReturnType<typeof useJobTeam>;now:number;onClose:()=>void}) {
 const countdown=startCountdown(current,now);
 return <Modal className={`detail-card bloom-job-frame ${styles.detailsDialog}`} title="Job details and rates" onClose={onClose}><div className={styles.jobFacts}><header data-modal-header>
  <p className={styles.factsEyebrow}>{current.management==='private'?'Your cleaning team':'Bloom Cleaning'} · Paid by {current.payerName??'Bloom'}</p>
  <h2>{current.propertyName}</h2>
  {!started&&current.status==='open'&&countdown.seconds>0&&<p className={styles.startCountdown}>{countdown.beforeReminder?'Start reminder in':'Start in'} {countdown.label}</p>}
  <p className={styles.factsDate}>{new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(new Date(`${current.checkoutDate}T12:00:00Z`))}</p>
  </header><div className={styles.timeWindow}><div><strong>{formatTime(current.startAt,current.timezone)}</strong><span>Start</span></div><div className={styles.timeLine} aria-hidden="true"/><div><strong>{formatTime(current.endAt,current.timezone)}</strong><span>Finish</span></div></div>
  <div className={styles.teamSection}><p>{current.timezone}</p>
   {team.loading&&!team.data?<Loading/>:team.error?<ErrorNotice error={team.error} retry={team.reload}/>:team.data?.map(cleaner=><div className={styles.teamMember} key={cleaner.id}><span className={styles.avatar}><CleanerAvatar name={cleaner.displayName} url={cleaner.avatarUrl}/></span><div><strong>{cleaner.displayName}{cleaner.id===user.id?' (You)':''}</strong><p>{current.status==='completed'?'Completed this cleaning':'Assigned to this cleaning'}</p></div></div>)}
   {current.activeCleanerCount<(current.capacity??2)&&<div className={styles.teamMember}><span className={`${styles.avatar} ${styles.openSlot}`} aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 4v16M4 12h16"/></svg></span><div><strong>{current.status==='open'?'Open cleaning slot':'Unfilled cleaning slot'}</strong><p>{current.management==='private'?'The owner manages replacements.':current.status==='open'?'Another eligible cleaner can join':'No cleaner assigned'}</p></div></div>}
  </div>
  <div className={styles.rateSection}><div><span>Your payout:</span><strong>{current.status==='completed'?(current.myCompletedPayCents===null?'Unavailable':money(current.myCompletedPayCents)):current.management==='private'?(current.myAgreedPayCents!=null?money(current.myAgreedPayCents):'Equal share at completion'):money(current.activeCleanerCount>=2?current.sharedRateCents:current.soloRateCents)}</strong></div>{current.status==='open'&&<p>{current.management==='private'&&current.myAgreedPayCents==null?`${money(current.soloRateCents)} total, divided among eligible participants at completion.`:'Provisional until completion.'}</p>}</div>
 </div></Modal>;
}
