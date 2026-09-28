'use client';
import {useCallback,useEffect,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import type {JobPhoto} from '../../contracts';
import {request} from './api';
import {ErrorNotice,Loading,useResource} from './primitives';
import {formatDate} from './dates';
import styles from './activity.module.css';

type ActivityPhoto=JobPhoto&{locationLabel:string};
type ActivityJob={id:string;propertyId:string;propertyName:string;date:string;timezone:string;completedAt:string|null;photoCount:number;photos:ActivityPhoto[]|null};
type ActivityPage={items:ActivityJob[];total:number};

function SavedPhoto({photo}:{photo:ActivityPhoto}) {
 const load=useCallback((signal:AbortSignal)=>request<{url:string;expiresAt:string}>(`/jobs/${photo.jobId}/photos/${photo.id}/read-url`,{body:{},signal}),[photo.jobId,photo.id]);
 const resource=useResource(load);
 const [failed,setFailed]=useState(false);
 useEffect(()=>{setFailed(false);},[resource.data]);
 return <figure className={styles.photo}>
  {resource.loading?<Loading/>:resource.error?<ErrorNotice error={resource.error} retry={resource.reload}/>:resource.data&&!failed?<a href={resource.data.url} target="_blank" rel="noopener noreferrer" aria-label={`Open full photo of ${photo.locationLabel}`}><img loading="lazy" src={resource.data.url} alt={`${photo.locationLabel} after cleaning`} onError={()=>setFailed(true)}/></a>:<p>Photo unavailable. <button className="bloom-button secondary" onClick={resource.reload}>Retry photo</button></p>}
  <figcaption>{photo.locationLabel}<small>Uploaded by {photo.uploaderName||'Cleaner'}</small><button className="bloom-button secondary" onClick={resource.reload}>Refresh photo link</button></figcaption>
 </figure>;
}
export function CleaningActivity({hub}:{hub:'owner'|'admin'}) {
 const router=useRouter(),query=useSearchParams(),job=query.get('job');
 const [offset,setOffset]=useState(0);
 const load=useCallback((signal:AbortSignal)=>request<ActivityPage>(`/activity?${job?'job='+encodeURIComponent(job):'offset='+offset}`,{signal}),[job,offset]);
 const resource=useResource(load);
 return <section aria-label="Completed cleaning activity" className={styles.activity}>
 <div className={styles.heading}><div><h2>{job?'Completion photos':'Activity'}</h2><p>Completed cleanings and saved photos, labeled by the cleaning’s assigned rooms.</p></div><button className="bloom-button secondary" onClick={resource.reload}>Refresh activity</button></div>
 {job&&<button className="bloom-button secondary" onClick={()=>router.push(`/${hub}?view=activity`)}>Back to activity</button>}
 {resource.loading?<Loading/>:resource.error?<ErrorNotice error={resource.error} retry={resource.reload}/>:<>
 {!resource.data?.items.length&&<p>No completed cleanings yet.</p>}
 {resource.data?.items.map(item=><article key={item.id} className={styles.card}><h3>{item.propertyName}</h3><p>{formatDate(item.date)} · {item.timezone} · Completed</p>
 {job?<>{item.photos?.length?Array.from(new Set(item.photos.map(photo=>photo.locationLabel))).map(label=><section key={label}><h4>{label}</h4><div className={styles.grid}>{item.photos!.filter(photo=>photo.locationLabel===label).map(photo=><SavedPhoto key={photo.id} photo={photo}/>)}</div></section>):<p>No saved completion photos are available for this cleaning.</p>}</>:<><p>{item.photoCount} saved {item.photoCount===1?'photo':'photos'}</p><button className="bloom-button" onClick={()=>router.push(`/${hub}?view=activity&job=${item.id}`)}>View completion photos →</button></>}
 </article>)}
 {!job&&!!resource.data?.total&&<nav className={styles.heading} aria-label="Activity pages"><button className="bloom-button secondary" disabled={!offset} onClick={()=>setOffset(n=>Math.max(0,n-10))}>Previous</button><span>{offset+1}–{Math.min(offset+10,resource.data.total)} of {resource.data.total}</span><button className="bloom-button secondary" disabled={offset+10>=resource.data.total} onClick={()=>setOffset(n=>n+10)}>Next</button></nav>}
 </>}
 </section>;
}
