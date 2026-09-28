'use client';
import {useCallback,useEffect,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import type {JobPhoto} from '../../contracts';
import {request} from './api';
import {ErrorNotice,Loading,useResource} from './primitives';
import {SelectorPill} from './selector-pill';
import {formatDate} from './dates';
import styles from './activity.module.css';

type ActivityPhoto=JobPhoto&{locationLabel:string};
type ActivityJob={id:string;propertyId:string;propertyName:string;date:string;timezone:string;completedAt:string|null;photoCount:number;photos:ActivityPhoto[]|null};
type ActivityPage={items:ActivityJob[];total:number};

function RefreshIcon(){return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/></svg>;}
const roomLabel=(label:string)=>label.replaceAll('_',' ').replace(/^./,letter=>letter.toUpperCase());
function RoomGallery({photos}:{photos:ActivityPhoto[]}) {
 const [mode,setMode]=useState<'carousel'|'grid'>('carousel'),[index,setIndex]=useState(0);
 const rooms=Array.from(new Set(photos.map(p=>p.roomId||p.locationLabel)));
 const current=Math.min(index,Math.max(0,rooms.length-1));
 const visible=mode==='grid'?photos:photos.filter(p=>(p.roomId||p.locationLabel)===rooms[current]);
 return <section aria-label="Completion photo gallery">
 <div className={styles.galleryToolbar}><div aria-live="polite">{mode==='carousel'&&photos.length>0&&<strong>{roomLabel(visible[0].locationLabel)} · Room {current+1} of {rooms.length}</strong>}</div>
 <SelectorPill aria-label="Photo layout">{(['carousel','grid'] as const).map(view=><button key={view} className={`vt-btn${mode===view?' active':''}`} aria-pressed={mode===view} onClick={()=>setMode(view)}>{view==='carousel'?'Carousel':'Grid'}</button>)}</SelectorPill></div>
 {photos.length?<><div className={styles.grid} data-mode={mode}>{visible.map(photo=><SavedPhoto key={photo.id} photo={photo}/>)}</div>
 {mode==='carousel'&&<nav className={styles.roomNavigation} aria-label="Room navigation"><button className={styles.circle} aria-label="Previous room" disabled={current===0} onClick={()=>setIndex(current-1)}>‹</button><span>{current+1} / {rooms.length}</span><button className={styles.circle} aria-label="Next room" disabled={current===rooms.length-1} onClick={()=>setIndex(current+1)}>›</button></nav>}</>:<p>No saved completion photos are available for this cleaning.</p>}
 </section>;
}
function SavedPhoto({photo}:{photo:ActivityPhoto}) {
 const load=useCallback((signal:AbortSignal)=>request<{url:string;expiresAt:string}>(`/jobs/${photo.jobId}/photos/${photo.id}/read-url`,{body:{},signal}),[photo.jobId,photo.id]);
 const resource=useResource(load);
 const [failed,setFailed]=useState(false);
 useEffect(()=>{setFailed(false);},[resource.data]);
 return <figure className={styles.photo}>
  {resource.loading?<Loading/>:resource.error?<ErrorNotice error={resource.error} retry={resource.reload}/>:resource.data&&!failed?<a href={resource.data.url} target="_blank" rel="noopener noreferrer" aria-label={`Open full photo of ${photo.locationLabel}`}><img loading="lazy" src={resource.data.url} alt={`${photo.locationLabel} after cleaning`} onError={()=>setFailed(true)}/></a>:<p>Photo unavailable. <button className="bloom-button secondary" onClick={resource.reload}>Retry photo</button></p>}
  <figcaption><span>{roomLabel(photo.locationLabel)}<small>Uploaded by {photo.uploaderName||'Cleaner'}</small></span><button className={styles.circle} aria-label={`Refresh photo of ${roomLabel(photo.locationLabel)}`} title="Refresh photo" onClick={resource.reload}><RefreshIcon/></button></figcaption>
 </figure>;
}
export function CleaningActivity({hub}:{hub:'owner'|'admin'}) {
 const router=useRouter(),query=useSearchParams(),job=query.get('job');
 const [offset,setOffset]=useState(0);
 const load=useCallback((signal:AbortSignal)=>request<ActivityPage>(`/activity?${job?'job='+encodeURIComponent(job):'offset='+offset}`,{signal}),[job,offset]);
 const resource=useResource(load);
 return <section aria-label="Completed cleaning activity" className={styles.activity}>
 <div className={styles.heading}><div><h2>{job?'Completion photos':'Activity'}</h2><p>Completed cleanings and saved photos, labeled by the cleaning’s assigned rooms.</p></div><button className={styles.circle} aria-label="Refresh activity" title="Refresh activity" onClick={resource.reload}><RefreshIcon/></button></div>
 {job&&<button className="bloom-button secondary" onClick={()=>router.push(`/${hub}?view=activity`)}>Back to activity</button>}
 {resource.loading?<Loading/>:resource.error?<ErrorNotice error={resource.error} retry={resource.reload}/>:<>
 {!resource.data?.items.length&&<p>No completed cleanings yet.</p>}
 {resource.data?.items.map(item=><article key={item.id} className={`${styles.card} ${job?'':styles.summary}`}>
 <div className={styles.summaryText}><h3>{item.propertyName}</h3><p>{formatDate(item.date)} · {item.timezone} · Completed{!job&&` · ${item.photoCount} saved ${item.photoCount===1?'photo':'photos'}`}</p></div>
 {job?<RoomGallery key={item.id} photos={item.photos??[]}/>:<button className="bloom-button" onClick={()=>router.push(`/${hub}?view=activity&job=${item.id}`)}>View completion photos →</button>}
 </article>)}
 {!job&&!!resource.data?.total&&<nav className={styles.heading} aria-label="Activity pages"><button className="bloom-button secondary" disabled={!offset} onClick={()=>setOffset(n=>Math.max(0,n-10))}>Previous</button><span>{offset+1}–{Math.min(offset+10,resource.data.total)} of {resource.data.total}</span><button className="bloom-button secondary" disabled={offset+10>=resource.data.total} onClick={()=>setOffset(n=>n+10)}>Next</button></nav>}
 </>}
 </section>;
}
