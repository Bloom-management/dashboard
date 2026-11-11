'use client';
import {useEffect,useState} from 'react';
import {api} from './api';
import {PhotoLightbox} from './photo-lightbox';
import styles from './note-photo-preview.module.css';
export function NotePhotoPreview({jobId,photoId,file,onRemove,disabled=false,status}:{jobId:string;photoId?:string;file?:File;onRemove?:()=>void;disabled?:boolean;status?:string}){
 const [url,setUrl]=useState<string>(),[viewing,setViewing]=useState(false),[failed,setFailed]=useState(false);
 useEffect(()=>{let active=true;setFailed(false);
 if(file){const local=URL.createObjectURL(file);setUrl(local);return()=>URL.revokeObjectURL(local);}
 if(photoId)void api.readPhoto(jobId,photoId).then(value=>{if(active)setUrl(value.url);}).catch(()=>{if(active)setFailed(true);});
 return()=>{active=false;};},[file,jobId,photoId]);
 return <div className={styles.preview}>
 <button type="button" className={styles.image} aria-label="Enlarge attached photo" disabled={!photoId||disabled} onClick={()=>setViewing(true)}>
 {url&&!failed?<img src={url} alt="Attached photo" onError={()=>setFailed(true)}/>:<span>{failed?'Preview unavailable':'Loading photo…'}</span>}
 </button>
 {onRemove&&<button type="button" className={styles.remove} aria-label="Remove attached photo" disabled={disabled} onClick={onRemove}><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg></button>}
 {status&&<span className={styles.status}>{status}</span>}
 {viewing&&photoId&&<PhotoLightbox jobId={jobId} photos={[{id:photoId,label:'Attached photo',removable:!!onRemove}]} index={0} onIndex={()=>{}} removing={disabled} onRemove={onRemove?()=>{setViewing(false);onRemove();}:undefined} onClose={()=>setViewing(false)}/>}
 </div>;
}
