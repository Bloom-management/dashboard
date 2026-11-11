'use client';
import type {RoomCompletionSummary} from '../../contracts/room-summary';
import {RoomReportItems,RoomReportPhotos,useRoomIssues} from './room-listings/summary';
import {NoteReport} from './job-notes';
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import type {CompletionReceipt} from '../../contracts';
import {request} from './api';
import {Modal,Loading,ErrorNotice,useResource} from './primitives';
import {GuestStars} from './guest-stars';
import {MaintenanceGrid,MaintenancePreview} from './maintenance';
import {CompletionPhotos} from './photos';
import {SupplyLevelBar} from './supply-level-bar';
import {SupplyIcon} from './supply-setup-grid';
import {supplyLevels} from './journey-draft';
import {formatDate} from './dates';
import styles from './cleaner-journey.module.css';
import {BackButton} from './back-button';
type Report={jobId:string;propertyName:string;date:string;receipt:CompletionReceipt|null;roomSummary?:RoomCompletionSummary};
export function CleaningReport({jobId,onClose}:{jobId:string;onClose:()=>void}) {
 const load=useCallback((signal:AbortSignal)=>request<Report>(`/jobs/${jobId}/report`,{signal}),[jobId]);
 const resource=useResource(load);
 return <Modal className={`detail-card bloom-job-frame bloom-job-surface ${styles.dialog} ${styles.sharedReport}`} title="Cleaning report" onClose={onClose}><div className={styles.layout}><section className={styles.task}>
 {resource.loading?<div className={styles.content}><Loading/></div>:resource.error?<div className={styles.content}><ErrorNotice error={resource.error} retry={resource.reload}/></div>:resource.data&&<CompletionReportContent report={resource.data} onClose={onClose}/>}
 </section></div></Modal>;
}
export function CompletionReportContent({report,onClose,details}:{report:Report;onClose?:()=>void;details?:ReactNode}) {
 const [section,setSection]=useState<'Supplies'|'Maintenance'|'Room photos'|'Review and notes'|null>(null);
 const heading=useRef<HTMLHeadingElement>(null);
 const lastSection=useRef<string|null>(null);
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{const frame=requestAnimationFrame(()=>{if(section)heading.current?.focus();else if(lastSection.current)Array.from(root.current?.querySelectorAll<HTMLButtonElement>(`[data-report-section="${lastSection.current}"]`)??[]).find(button=>button.getClientRects().length>0)?.focus();});return()=>cancelAnimationFrame(frame);},[section]);
 const open=(value:typeof section,trigger?:string)=>{if(value)lastSection.current=trigger??value;setSection(value);};
 const receipt=report.receipt,jobId=report.jobId,roomSummary=report.roomSummary;
 const issues=useRoomIssues(jobId,!!roomSummary);
 const unresolved=issues.data?.issues.filter(issue=>!issue.resolvedAt).length??0;
 return <div ref={root} className={styles.sharedReport}>
 {section?<header className={styles.heading}><BackButton onClick={()=>open(null)}>Back to cleaning</BackButton><h1 ref={heading} tabIndex={-1}>{section}</h1></header>:<header className={styles.heading}><div className={styles.headingRow}><span className={styles.kicker}>Completed</span>{details}</div><h1>Cleaning complete.</h1><p>Completed for the whole job. No admin approval is needed.</p>{receipt?.guestReview&&<ol className={styles.completionSteps} aria-label="Cleaning completion progress">{['Room photos','Supplies check','Maintenance','Condition after checkout','Done'].map((label,index)=><li key={label} aria-current={index===4?'step':undefined}><span className={styles.stepCircle} aria-hidden="true">{index===4?'5':'✓'}</span><span>{label}</span></li>)}</ol>}</header>}
 <div className={styles.content}><p>{formatDate(report.date)} · {report.propertyName}</p>
 {section==='Review and notes'?<ReviewNotes receipt={receipt}/>:section==='Maintenance'?roomSummary?<><RoomReportItems summary={roomSummary} kind="maintenance" jobId={jobId} issues={issues.data??undefined} onResolved={issues.reload}/><NoteReport jobId={jobId} section="maintenance"/></>:<>{receipt?.notes&&<section><h3>Anything that needs attention?</h3><p className="bloom-prewrap">{receipt.notes}</p></section>}<MaintenanceGrid showHeading={false} reports={receipt?.maintenance??[]}/><NoteReport jobId={jobId} section="maintenance"/></>:section==='Room photos'?roomSummary?<RoomReportPhotos jobId={jobId} summary={roomSummary}/>:<CompletionPhotos jobId={jobId}/>:section==='Supplies'?roomSummary?<><RoomReportItems summary={roomSummary} kind="supply"/><NoteReport jobId={jobId} section="supplies"/></>:<><NoteReport jobId={jobId} section="supplies"/><div className={styles.receiptSupplies}>{receipt?.reports.map(item=><article className={styles.receiptSupply} key={item.supplyId}><SupplyIcon/><strong>{item.name}</strong><span>{supplyLevels[item.level]}</span><SupplyLevelBar level={item.level}/></article>)}{!receipt?.reports.length&&<p>No supply report was provided.</p>}</div></>:<>
 <ReviewNotes receipt={receipt} onMore={trigger=>open('Review and notes',trigger)}/>
 <button type="button" data-report-section="Room photos" className={`bloom-button secondary ${styles.mobilePhotoAction}`} onClick={()=>open('Room photos')}>View room photos</button>
 <nav className={`bloom-job-sections ${styles.reportFolders}`} aria-label="Completion reports"><button type="button" data-report-section="Room photos" className={`bloom-section-folder ${styles.photoFolder}`} onClick={()=>open('Room photos')}><span className="bloom-section-preview" aria-hidden="true"><span className="bloom-section-mini"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h4l2-3h4l2 3h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4"/></svg></span></span><span className="row-head">Room photos</span></button>{(['Supplies','Maintenance'] as const).map(label=><button className="bloom-section-folder" type="button" data-report-section={label} key={label} onClick={()=>open(label)}>{label==='Maintenance'?<>{unresolved>0&&<span className="bloom-issue-badge" aria-label={`${unresolved} unresolved maintenance ${unresolved===1?'issue':'issues'}`}>!</span>}<MaintenancePreview/></>:<span className="bloom-section-preview" aria-hidden="true">{receipt?.reports.length?receipt.reports.slice(0,4).map(item=><span className="bloom-section-mini" key={item.supplyId}><SupplyIcon/></span>):<span className="bloom-section-preview-empty">No supplies</span>}</span>}<span className="row-head">{label}</span></button>)}</nav>
 {onClose&&<button type="button" className="bloom-button" onClick={onClose}>Back to calendar</button>}
 </>}
 </div></div>;
}

function ReviewNotes({receipt,onMore}:{receipt:CompletionReceipt|null;onMore?:(trigger:string)=>void}) {
 return <><section aria-label="Guest review"><h3>Condition after checkout{receipt?.guestReview?`: ${receipt.guestReview.rating}/5`:''}</h3>{receipt?.guestReview?<><GuestStars value={receipt.guestReview.rating}/><ReportText text={receipt.guestReview.comment||'No guest comment provided.'} label="guest review" onMore={onMore}/></>:<p>Not provided</p>}</section><section aria-label="Cleaning notes"><h3>Cleaning notes</h3><ReportText text={receipt?.notes||'Not provided'} label="cleaning notes" onMore={onMore}/></section></>;
}
function ReportText({text,label,onMore}:{text:string;label:string;onMore?:(trigger:string)=>void}) {
 const paragraph=useRef<HTMLParagraphElement>(null);
 const [truncated,setTruncated]=useState(false);
 useEffect(()=>{const element=paragraph.current;if(!element||!onMore)return;const measure=()=>setTruncated(element.scrollHeight>element.clientHeight+1);measure();const observer=new ResizeObserver(measure);observer.observe(element);void document.fonts.ready.then(measure);return()=>observer.disconnect();},[text,onMore]);
 return <><p ref={paragraph} className={`bloom-prewrap ${onMore?styles.reportPreview:''}`}>{text}</p>{onMore&&truncated&&<button type="button" className={styles.reportMore} data-report-section={label} aria-label={`See more ${label}`} onClick={()=>onMore(label)}>See more</button>}</>;
}
