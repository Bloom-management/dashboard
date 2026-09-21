'use client';
import type {CleanerJob} from '../../contracts';
import {formatDate,formatTime,money} from './dates';
import {Modal} from './primitives';

export function CleanerDayDialog({date,jobs,onSelect,onClose}:{date:string;jobs:CleanerJob[];onSelect:(job:CleanerJob)=>void;onClose:()=>void}){
 return <Modal className="cleaner-day-dialog" title={`Cleanings for ${formatDate(date)}`} onClose={onClose}><header><p className="cleaner-day-eyebrow">Your cleaning calendar</p><h2>{formatDate(date)}</h2><p>{jobs.length} {jobs.length===1?'cleaning':'cleanings'} · Times are local to each property</p></header>{jobs.length?<ul className="cleaner-day-jobs">{[...jobs].sort((a,b)=>a.startAt.localeCompare(b.startAt)||a.propertyName.localeCompare(b.propertyName)).map(job=><li key={job.id}><button type="button" onClick={()=>onSelect(job)}><strong>{job.propertyName}</strong><span>{formatTime(job.startAt,job.timezone)}–{formatTime(job.endAt,job.timezone)} · {job.timezone}</span><span>{job.activeCleanerCount}/2 cleaners assigned · {job.status}</span><span>{money(job.soloRateCents)} solo · {money(job.sharedRateCents)} shared</span>{job.myAssignmentId&&<span className="cleaner-day-assigned">You’re assigned</span>}{job.reviewRequired&&<span>Booking changes need admin attention</span>}<span className="cleaner-day-link">View cleaning →</span></button></li>)}</ul>:<p className="cleaner-day-empty">No cleanings for this day with your current filters.</p>}</Modal>;
}
