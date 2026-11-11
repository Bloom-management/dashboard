'use client';
import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {Modal} from './primitives';
import styles from './photo-lightbox.module.css';

export type LightboxPhoto={id:string;label:string;removable?:boolean};

/** Full-screen photo viewer: close, delete, previous/next, dots and swipe. */
export function PhotoLightbox({jobId,photos,index,onIndex,onRemove,onClose,removing=false}:{jobId:string;photos:LightboxPhoto[];index:number;onIndex:(index:number)=>void;onRemove?:(photoId:string)=>void;onClose:()=>void;removing?:boolean}){
 const photo=photos[Math.min(index,photos.length-1)];
 const [urls,setUrls]=useState<Record<string,string|null>>({});
 const touch=useRef<number|null>(null);
 const many=photos.length>1;
 const step=(delta:number)=>{if(many)onIndex((index+delta+photos.length)%photos.length);};
 useEffect(()=>{
  if(!photo||photo.id in urls)return;
  let active=true;
  api.readPhoto(jobId,photo.id).then(value=>{if(active)setUrls(current=>({...current,[photo.id]:value.url}));}).catch(()=>{if(active)setUrls(current=>({...current,[photo.id]:null}));});
  return()=>{active=false;};
 },[jobId,photo,urls]);
 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{if(event.key==='ArrowLeft')step(-1);else if(event.key==='ArrowRight')step(1);};
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 });
 if(!photo)return null;
 const url=urls[photo.id];
 return <Modal className={styles.lightbox} showClose={false} title={photo.label} onClose={onClose}>
  <div className={styles.stage} onTouchStart={event=>{touch.current=event.touches[0]?.clientX??null;}} onTouchEnd={event=>{const start=touch.current;touch.current=null;const end=event.changedTouches[0]?.clientX;if(start==null||end==null||Math.abs(end-start)<40)return;step(end<start?1:-1);}}>
   <button type="button" autoFocus className={`${styles.round} ${styles.close}`} aria-label="Close photo" onClick={onClose}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
   {onRemove&&photo.removable&&<button type="button" className={`${styles.round} ${styles.trash}`} aria-label="Delete photo" disabled={removing} onClick={()=>onRemove(photo.id)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg></button>}
   <figure className={styles.figure}>
    {url?<img src={url} alt={photo.label}/>:<span className={styles.status}>{url===null?'Photo unavailable':'Loading photo…'}</span>}
    <figcaption>{photo.label}</figcaption>
   </figure>
   {many&&<><button type="button" className={`${styles.round} ${styles.previous}`} aria-label="Previous photo" onClick={()=>step(-1)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></button><button type="button" className={`${styles.round} ${styles.next}`} aria-label="Next photo" onClick={()=>step(1)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>
    <div className={styles.dots} role="tablist" aria-label="Photos">{photos.map((item,i)=><button type="button" role="tab" key={item.id} aria-selected={i===index} aria-label={`Photo ${i+1} of ${photos.length}`} onClick={()=>onIndex(i)}/>)}</div></>}
  </div>
 </Modal>;
}
