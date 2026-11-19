'use client';
import {useEffect,useState} from 'react';
import type {CleanerJob} from '../../contracts';
import {formatDate,formatTime,todayIn} from './dates';
import {Icon} from './primitives';
import styles from './check-in.module.css';

/** Property-local check-in day, kept short for the tile: "today", "tomorrow", "same day", or "Nov 25". */
function relativeDay(instant:string,timezone:string,checkoutDate:string,now:number){
 const day=todayIn(timezone,new Date(instant)),today=todayIn(timezone,new Date(now));
 const diff=Math.round((Date.parse(`${day}T12:00:00Z`)-Date.parse(`${today}T12:00:00Z`))/86400000);
 if(diff===0)return 'today';
 if(diff===1)return 'tomorrow';
 if(day===checkoutDate)return 'same day';
 return new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(new Date(`${day}T12:00:00Z`));
}

export function checkInLabel(job:CleanerJob,now:number){
 if(!job.checkInAt)return null;
 const [time='',meridiem='']=formatTime(job.checkInAt,job.timezone).split(/\s+/);
 return {time,meridiem,day:relativeDay(job.checkInAt,job.timezone,job.checkoutDate,now)};
}

function useNow(intervalMs=30000){
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),intervalMs);return()=>clearInterval(timer);},[intervalMs]);
 return now;
}

const HOUR=3600000;
export type CheckInTone='none'|'calm'|'soon'|'urgent';

/** Tile urgency: only today/tomorrow check-ins show; colour warms as an unstarted cleaning nears check-in. */
export function checkInTone(job:CleanerJob,now:number):CheckInTone{
 const label=checkInLabel(job,now);
 if(!label||(label.day!=='today'&&label.day!=='tomorrow'))return 'none';
 const left=Date.parse(job.checkInAt!)-now;
 if(job.started||job.status!=='open'||left<=0)return 'calm';
 return left<=3*HOUR?'urgent':left<=8*HOUR?'soon':'calm';
}

/** Leading time column on a claim card: the guest check-in that bounds the cleaning. */
export function CheckInTile({job}:{job:CleanerJob}){
 const now=useNow(60000),label=checkInLabel(job,now),tone=checkInTone(job,now);
 return <span className={styles.tile} data-tone={tone}>
  <span className={styles.tileCap}>Check-in</span>
  {tone!=='none'&&label?<><span className={styles.tileTime}>{label.time}</span><span className={styles.tileDay}>{label.meridiem} {label.day}</span></>:<><span className={styles.tileTime}>None</span><span className={styles.tileDay}>scheduled</span></>}
 </span>;
}

/** One-line check-in mention for claimed-job info. */
export function CheckInNote({job,now}:{job:CleanerJob;now:number}){
 const label=checkInLabel(job,now);
 return <p className={styles.note}><Icon name="door" size={16}/><span>Guest check-in</span><strong>{label?`${label.time} ${label.meridiem} ${label.day}`:'None booked'}</strong></p>;
}

function duration(ms:number){
 const minutes=Math.max(0,Math.ceil(ms/60000)),d=Math.floor(minutes/1440),h=Math.floor(minutes%1440/60),m=minutes%60;
 return d?`${d}d ${h}h`:h?`${h}h ${m}m`:`${m}m`;
}

/** Live cleaning-window timeline: elapsed and remaining time, plus the guest check-in that follows. */
export function CleaningWindow({job}:{job:CleanerJob}){
 const now=useNow(),start=Date.parse(job.startAt),end=Date.parse(job.endAt);
 const checkIn=job.checkInAt?Date.parse(job.checkInAt):null;
 const hasGap=checkIn!==null&&checkIn>end;
 const windowShare=hasGap?80:100;
 const clamp=(value:number)=>Math.min(1,Math.max(0,value));
 const position=now<start?0:now<=end?clamp((now-start)/(end-start))*windowShare:hasGap&&now<checkIn!?windowShare+clamp((now-end)/(checkIn!-end))*(100-windowShare):windowShare;
 const live=now>=start&&now<=(hasGap?checkIn!:end)&&job.status==='open';
 const status=job.status==='completed'?{tone:'done',text:'Completed'}:job.status==='cancelled'?{tone:'closed',text:'Cancelled'}:now<start?{tone:'upcoming',text:`Starts in ${duration(start-now)}`}:now<=end?{tone:'live',text:`${duration(end-now)} left`}:{tone:'closed',text:'Window closed'};
 const checkInDay=checkIn!==null&&todayIn(job.timezone,new Date(checkIn))!==job.checkoutDate?`${new Intl.DateTimeFormat('en-US',{timeZone:job.timezone,weekday:'short'}).format(new Date(checkIn))} `:'';
 const nowLabel=`Now ${formatTime(new Date(now).toISOString(),job.timezone)}`;
 return <div className={styles.window}>
  <div className={styles.head}><div className="row-head">Cleaning window</div><span className={styles.badge} data-tone={status.tone}>{status.text}</span></div>
  <div className={styles.ends}><div><span className={styles.endTime}>{formatTime(job.startAt,job.timezone)}</span><span className={styles.endCap}>Start</span></div><div><span className={styles.endTime}>{formatTime(job.endAt,job.timezone)}</span><span className={styles.endCap}>Finish</span></div></div>
  <div className={styles.track} data-checkin={checkIn!==null||undefined}>
   {checkIn!==null&&<span className={styles.flag}><Icon name="door" size={15}/>Check-in {checkInDay}{formatTime(job.checkInAt!,job.timezone)}</span>}
   <span className={styles.bar} aria-hidden="true">
    <span className={styles.past} style={{width:`${Math.min(position,windowShare)}%`}}/>
    <span className={styles.remaining} style={{left:`${Math.min(position,windowShare)}%`,width:`${windowShare-Math.min(position,windowShare)}%`}}/>
    {hasGap&&<span className={styles.gap} style={{left:`${windowShare}%`}}/>}
    <span className={styles.tick} style={{left:0}}/><span className={styles.tick} style={{left:`${windowShare}%`}}/>{checkIn!==null&&<span className={`${styles.tick} ${styles.checkInTick}`} style={{left:'100%'}}/>}
    {live&&<span className={styles.dot} style={{left:`${position}%`}}/>}
   </span>
   {live&&<span className={styles.nowLabel} style={{left:`clamp(56px, ${position}%, calc(100% - 56px))`}}>{nowLabel}</span>}
  </div>
  <p className="window-note">{formatDate(job.checkoutDate)} · {job.timezone}</p>
 </div>;
}
