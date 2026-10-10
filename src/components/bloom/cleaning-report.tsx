'use client';
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import type {CompletionReceipt} from '../../contracts';
import {request} from './api';
import {Modal,Loading,ErrorNotice,useResource} from './primitives';
import {GuestStars} from './guest-stars';
import {MaintenanceGrid,MaintenancePreview} from './maintenance';
import {CompletionPhotos} from './photos';
import {SupplyIcon} from './supply-setup-grid';
import {supplyLevels} from './journey-draft';
import {formatDate} from './dates';
import styles from './cleaner-journey.module.css';
type Report={jobId:string;propertyName:string;date:string;receipt:CompletionReceipt|null};
export function CleaningReport({jobId,onClose}:{jobId:string;onClose:()=>void}) {
 const load=useCallback((signal:AbortSignal)=>request<Report>(`/jobs/${jobId}/report`,{signal}),[jobId]);
 const resource=useResource(load);
 return <Modal className={`detail-card bloom-job-surface ${styles.dialog} ${styles.sharedReport}`} title="Cleaning report" onClose={onClose}><div className={styles.layout}><section className={styles.task}>
 {resource.loading?<div className={styles.content}><Loading/></div>:resource.error?<div className={styles.content}><ErrorNotice error={resource.error} retry={resource.reload}/></div>:resource.data&&<CompletionReportContent report={resource.data} onClose={onClose}/>}
 </section></div></Modal>;
}
export function CompletionReportContent({report,onClose,details}:{report:Report;onClose?:()=>void;details?:ReactNode}) {
 const [section,setSection]=useState<'Supplies'|'Maintenance'|'Room photos'|'Review and notes'|null>(null);
 const heading=useRef<HTMLHeadingElement>(null);
 const lastSection=useRef<string|null>(null);
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{const frame=requestAnimationFrame(()=>{if(section)heading.current?.focus();else if(lastSection.current)root.current?.querySelector<HTMLButtonElement>(`[data-report-section="${lastSection.current}"]`)?.focus();});return()=>cancelAnimationFrame(frame);},[section]);
 const open=(value:typeof section,trigger?:string)=>{if(value)lastSection.current=trigger??value;setSection(value);};
 const receipt=report.receipt,jobId=report.jobId;
 return <div ref={root} className={styles.sharedReport}>
 {section?<header className={styles.heading}><button type="button" className="bloom-button secondary" onClick={()=>open(null)}>← Back to cleaning</button><h1 ref={heading} tabIndex={-1}>{section}</h1></header>:<header className={styles.heading}><div className={styles.headingRow}><span className={styles.kicker}>Completed</span>{details}</div><h1>Cleaning complete.</h1><p>Completed for the whole job. No admin approval is needed.</p>{receipt?.guestReview&&<ol className={styles.completionSteps} aria-label="Cleaning completion progress">{['Room photos','Supplies check','Maintenance','Guest rating','Done'].map((label,index)=><li key={label} aria-current={index===4?'step':undefined}><span className={styles.stepCircle} aria-hidden="true">{index===4?'5':'✓'}</span><span>{label}</span></li>)}</ol>}</header>}
 <div className={styles.content}><p>{formatDate(report.date)} · {report.propertyName}</p>
 {section==='Review and notes'?<ReviewNotes receipt={receipt}/>:section==='Maintenance'?<MaintenanceGrid showHeading={false} reports={receipt?.maintenance??[]}/>:section==='Room photos'?<CompletionPhotos jobId={jobId}/>:section==='Supplies'?<div className={styles.receiptSupplies}>{receipt?.reports.map(item=><article className={styles.receiptSupply} key={item.supplyId}><SupplyIcon/><strong>{item.name}</strong><span>{supplyLevels[item.level]}</span></article>)}{!receipt?.reports.length&&<p>No supply report was provided.</p>}</div>:<>
 <ReviewNotes receipt={receipt} onMore={trigger=>open('Review and notes',trigger)}/>
 <button type="button" data-report-section="Room photos" className="bloom-button secondary" onClick={()=>open('Room photos')}>View room photos</button>
 <nav className={`bloom-job-sections ${styles.reportFolders}`} aria-label="Completion reports">{(['Supplies','Maintenance'] as const).map(label=><button className="bloom-section-folder" type="button" data-report-section={label} key={label} onClick={()=>open(label)}>{label==='Maintenance'?<MaintenancePreview/>:<span className="bloom-section-preview" aria-hidden="true">{receipt?.reports.length?receipt.reports.slice(0,4).map(item=><span className="bloom-section-mini" key={item.supplyId}><SupplyIcon/></span>):<span className="bloom-section-preview-empty">No supplies</span>}</span>}<span className="row-head">{label}</span></button>)}</nav>
 {onClose&&<button type="button" className="bloom-button" onClick={onClose}>Back to calendar</button>}
 </>}
 </div></div>;
}

function ReviewNotes({receipt,onMore}:{receipt:CompletionReceipt|null;onMore?:(trigger:string)=>void}) {
 return <><section aria-label="Guest review"><h3>Guest rating{receipt?.guestReview?`: ${receipt.guestReview.rating}/5`:''}</h3>{receipt?.guestReview?<><GuestStars value={receipt.guestReview.rating}/><ReportText text={receipt.guestReview.comment||'No guest comment provided.'} label="guest review" onMore={onMore}/></>:<p>Not provided</p>}</section><section aria-label="Cleaning notes"><h3>Cleaning notes</h3><ReportText text={receipt?.notes||'Not provided'} label="cleaning notes" onMore={onMore}/></section></>;
}
function ReportText({text,label,onMore}:{text:string;label:string;onMore?:(trigger:string)=>void}) {
 const paragraph=useRef<HTMLParagraphElement>(null);
 const [truncated,setTruncated]=useState(false);
 useEffect(()=>{const element=paragraph.current;if(!element||!onMore)return;const measure=()=>setTruncated(element.scrollHeight>element.clientHeight+1);measure();const observer=new ResizeObserver(measure);observer.observe(element);void document.fonts.ready.then(measure);return()=>observer.disconnect();},[text,onMore]);
 return <><p ref={paragraph} className={`bloom-prewrap ${onMore?styles.reportPreview:''}`}>{text}</p>{onMore&&truncated&&<button type="button" className={styles.reportMore} data-report-section={label} aria-label={`See more ${label}`} onClick={()=>onMore(label)}>See more</button>}</>;
}
