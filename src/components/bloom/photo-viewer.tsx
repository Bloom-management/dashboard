'use client';
import {useCallback,useRef,useState} from 'react';
import {api} from './api';
import {Modal,Loading,ErrorNotice,useResource} from './primitives';
import styles from './photo-viewer.module.css';

export function PhotoViewer({jobId,photoId,label,onClose}:{jobId:string;photoId:string;label:string;onClose:()=>void}){
 const [zoom,setZoom]=useState(1),[failed,setFailed]=useState(false);
 const viewport=useRef<HTMLDivElement>(null);
 const load=useCallback(()=>api.readPhoto(jobId,photoId),[jobId,photoId]);
 const photo=useResource(load);
 function resize(next:number){setZoom(Math.min(4,Math.max(1,next)));if(next<=1)viewport.current?.scrollTo({top:0,left:0});}
 return <Modal title={label} onClose={onClose}>
 <div className={styles.controls} role="group" aria-label="Photo zoom">
 <button type="button" aria-label="Zoom out" disabled={zoom<=1} onClick={()=>resize(zoom-.5)}>−</button>
 <output aria-live="polite">{Math.round(zoom*100)}%</output>
 <button type="button" aria-label="Zoom in" disabled={zoom>=4} onClick={()=>resize(zoom+.5)}>+</button>
 <button type="button" onClick={()=>resize(1)}>Fit photo</button>
 </div>
 {photo.loading?<Loading/>:photo.error?<ErrorNotice error={photo.error} retry={photo.reload}/>:failed?<p role="alert">This photo could not load. <button type="button" onClick={()=>{setFailed(false);photo.reload();}}>Retry photo</button></p>:
 <div ref={viewport} className={styles.viewport} tabIndex={0} aria-label="Photo; scroll to explore when zoomed">
 <div className={styles.canvas} style={{width:zoom*100+'%',height:zoom*100+'%'}}>
 <button type="button" className={styles.imageButton} aria-label={zoom===1?'Zoom photo to 200%':'Fit photo to viewer'} onClick={()=>resize(zoom===1?2:1)} style={{cursor:zoom===1?'zoom-in':'zoom-out'}}>
 <img src={photo.data?.url} alt={label} onError={()=>setFailed(true)} style={{width:'100%',height:'100%',maxHeight:'none',objectFit:'contain'}}/>
 </button>
 </div></div>}
 </Modal>;
}
