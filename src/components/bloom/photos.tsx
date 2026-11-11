'use client';
import {PhotoLightbox} from './photo-lightbox';
import {createPortal} from 'react-dom';
import {NotePhotoPreview} from './note-photo-preview';
import {PhotoPicker} from './photo-picker';
import {preparePhotoFile} from './photo-file';
import {schedulePhotoUpload} from './photo-upload-scheduler';
import {Select} from '../ui/select';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CleanerJob, CleaningRoom, JobPhoto, PhotoCategory, SessionUser } from '../../contracts';
import { api, ApiError, request } from './api';
import type { BloomIntegration, UploadTicket } from './integration';
import { ErrorNotice, Loading, useResource } from './primitives';
import { readPhotoDrafts, writePhotoDrafts } from './photo-drafts';

/** Comments (supplies, maintenance, guest and item notes) allow at most this many photos. */
export const MAX_NOTE_PHOTOS=5;
async function contentHash(file:Blob){const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');}

export const categories: Record<PhotoCategory, string> = { bedrooms: 'Bedrooms', bathrooms: 'Bathrooms', kitchen: 'Kitchen', living_room: 'Living room' };
type UploadItem = { roomId?: string; id: string; file: File; category: PhotoCategory; key: string; finalizeKey: string; ticket?: UploadTicket; uploaded?: boolean; progress: number; state: 'queued' | 'uploading' | 'failed' | 'ready'; error?: unknown };

/** Chat-style thumbnail with an inline remove button; opens the full-screen viewer. */
export function Photo({ photo, jobId, label, onOpen, onRemove, disabled = false, removing = false }: { photo: JobPhoto; jobId: string; label: string; onOpen?: () => void; onRemove?: () => void; disabled?: boolean; removing?: boolean }) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [viewing, setViewing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const name = photo.noteContext ? 'Note attachment' : categories[photo.category];
  useEffect(() => {
    if (photo.state !== 'ready') return;
    let active = true, timer = 0;
    setError(undefined);
    api.readPhoto(jobId, photo.id).then(result => {
      if (!active) return;
      setUrl(result.url);
      timer = window.setTimeout(() => setAttempt(value => value + 1), Math.max(1000, Date.parse(result.expiresAt) - Date.now() - 5000));
    }).catch(failure => { if (active) { setUrl(undefined); setError(failure); } });
    return () => { active = false; clearTimeout(timer); };
  }, [jobId, photo.id, photo.state, attempt]);
  return <figure className="bloom-photo bloom-photo-tile" data-removing={removing || undefined} aria-busy={removing || undefined}>
    <div className="bloom-photo-frame">
      <button type="button" className="bloom-photo-thumb" aria-label={`Open ${name} photo`} disabled={photo.state !== 'ready'} onClick={() => onOpen ? onOpen() : setViewing(true)}>
        {url ? <img src={url} alt={`${name}, uploaded by ${label}`} onError={() => { setUrl(undefined); setError(new ApiError('SOURCE_UNAVAILABLE', 'Photo link expired or unavailable. Try again.')); }} /> : <span>{photo.state !== 'ready' ? 'Upload pending' : error ? 'Preview unavailable' : 'Loading…'}</span>}
      </button>
      {onRemove && <button type="button" className="bloom-photo-remove" aria-label={`Remove ${name} photo`} disabled={disabled} onClick={onRemove}><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg></button>}
    </div>
    <figcaption>{removing ? 'Removing…' : <>{name} · {label}{photo.state === 'ready' && <span aria-label="Photo saved"> · ✓</span>}</>}</figcaption>
    {!!error && <ErrorNotice error={error} retry={() => setAttempt(value => value + 1)} />}
    {viewing && <PhotoLightbox jobId={jobId} photos={[{ id: photo.id, label: `${name} · ${label}`, removable: !!onRemove }]} index={0} onIndex={() => {}} onRemove={onRemove ? () => { setViewing(false); onRemove(); } : undefined} onClose={() => setViewing(false)} />}
  </figure>;
}

export function Photos({ job, user, integration, onCoverage, rooms, locked = false, noteContext, itemId, onPendingChange, pickerTarget, previewTarget }: { itemId?: string; previewTarget?:HTMLElement|null; pickerTarget?:HTMLElement|null; onPendingChange?:(pending:boolean)=>void; noteContext?: 'supplies'|'maintenance'|'guest'; rooms?: CleaningRoom[]; locked?: boolean; job: CleanerJob; user: SessionUser; integration: BloomIntegration; onCoverage?: (complete: boolean) => void }) {
  // Note photos for one room maintenance item carry the item id as roomId; section notes have none.
  const loader = useCallback(async(signal: AbortSignal) => (await api.photos(job.id, signal)).filter(photo=>(photo.noteContext??undefined)===noteContext&&(!noteContext||(itemId?photo.roomId===itemId:!photo.roomId))), [job.id,noteContext,itemId]);
  const collection = useResource(loader,true);
  const [category, setCategory] = useState<PhotoCategory>('bedrooms');
  const [queue, setQueue] = useState<UploadItem[]>([]);
  const [removing,setRemoving]=useState<string>();
  const [viewing,setViewing]=useState<{group:string;index:number}|null>(null);
  const [removed,setRemoved]=useState<Set<string>>(()=>new Set());
  const [fileError, setFileError] = useState<unknown>();
  const [preparing,setPreparing]=useState(0);
  // Comment photos: fingerprints of what is already attached (queue item or photo id -> hash), and a brief notice.
  const fingerprints=useRef(new Map<string,string>());
  const [notice,setNotice]=useState<string>();
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(undefined),3200);return()=>clearTimeout(timer);},[notice]);
  useEffect(()=>{onPendingChange?.(preparing>0||queue.some(item=>item.state==='queued'||item.state==='uploading'));},[preparing,queue,onPendingChange]);
  useEffect(()=>()=>onPendingChange?.(false),[onPendingChange]);
  const [draftsReady,setDraftsReady]=useState(false);
  const [draftStorageError,setDraftStorageError]=useState(false);
  const draftKey=`${user.id}:${job.id}${noteContext?':'+noteContext:''}${itemId?':'+itemId:''}`;
  useEffect(()=>{let current=true;void readPhotoDrafts<UploadItem>(draftKey).then(items=>{if(current)setQueue(items.map(item=>({...item,state:'failed',error:new ApiError('NETWORK_ERROR','Saved upload restored. Retry to resume this photo.')})));}).catch(()=>{if(current)setDraftStorageError(true);}).finally(()=>{if(current)setDraftsReady(true);});return()=>{current=false;};},[draftKey]);
  const persistedDraft=useRef('');
  useEffect(()=>{const signature=JSON.stringify([draftKey,queue.map(item=>[item.id,item.state,item.uploaded])]);if(!draftsReady||signature===persistedDraft.current)return;persistedDraft.current=signature;if(draftsReady)void writePhotoDrafts(draftKey,queue.filter(item=>item.state!=='ready').map(({ticket:_ticket,error:_error,...item})=>item)).catch(()=>setDraftStorageError(true));},[queue,draftsReady,draftKey]);
  const active = useRef(new Set<string>());
  const controllers = useRef(new Set<AbortController>());
  const accessDenied = collection.error instanceof ApiError && ['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'].includes(collection.error.code);
  const canUpload = draftsReady && !locked && !accessDenied && (user.role === 'cleaner' || user.role === 'admin') && !!job.myAssignmentId && job.status === 'open' && !job.reviewRequired;
  const allowed = useRef(canUpload);
  allowed.current = canUpload;
  useEffect(() => {
    allowed.current = canUpload;
    const running = controllers.current;
    return () => { allowed.current = false; running.forEach(controller => controller.abort()); };
  }, []);
  useEffect(() => {
    if (!canUpload) controllers.current.forEach(controller => controller.abort());
  }, [canUpload]);
  useEffect(() => {
    const timer = window.setInterval(()=>{if(document.visibilityState==='visible'&&!active.current.size)collection.reload();}, 30000);
    return () => clearInterval(timer);
  }, [collection.reload]);
  useEffect(() => {
    onCoverage?.(!!collection.data && (rooms ? rooms.every(room => collection.data!.some(photo => photo.roomId === room.id && photo.state === 'ready')) : Object.keys(categories).every(category => collection.data!.some(photo => photo.category === category && photo.state === 'ready'))));
  }, [collection.data, onCoverage, rooms]);
  function update(id: string, patch: Partial<UploadItem>) { setQueue(items => items.map(item => item.id === id ? { ...item, ...patch } : item)); }
  async function upload(item: UploadItem) {
    const prepareUpload=integration.prepareUpload;
    if (!prepareUpload || active.current.has(item.id)) return;
    if (!allowed.current) {update(item.id,{state:'failed',error:new ApiError('NETWORK_ERROR','Upload paused. Retry when this cleaning is available.')});return;}
    active.current.add(item.id);
    const controller = new AbortController(); controllers.current.add(controller);
    update(item.id, { state: 'queued', error: undefined });
    try {
      await schedulePhotoUpload(async()=>{
      controller.signal.throwIfAborted();
      update(item.id, { state: 'uploading', error: undefined });
      // Persist the ticket and stage across retries, including an uncertain finalize response.
      const ticket = item.ticket ?? await prepareUpload(job.id, item.category, item.file, item.key, controller.signal, item.roomId,noteContext);
      controller.signal.throwIfAborted();
      update(item.id, { ticket });
      if (!item.uploaded) {
        await ticket.upload(item.file, progress => update(item.id, { progress }), controller.signal);
        controller.signal.throwIfAborted();
        update(item.id, { uploaded: true, progress: 100 });
      }
      await api.finalize(job.id, ticket.photoId, item.finalizeKey);
      if (!controller.signal.aborted) { update(item.id, { state: 'ready' }); collection.reload(); }
      });
    } catch (error) {
      if (controller.signal.aborted) update(item.id,{state:'failed',error:new ApiError('NETWORK_ERROR','Upload paused. Retry when this cleaning is available.')});
      else {
        update(item.id, { state: 'failed', error });
        if (error instanceof ApiError && ['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'].includes(error.code)) collection.reload();
      }
    }
    finally { controllers.current.delete(controller); active.current.delete(item.id); }
  }
  async function add(files: FileList | null, selectedRoom?: CleaningRoom) {
    if (!files) return;
    const selected=Array.from(files);
    setPreparing(count=>count+1);
    setFileError(undefined);
    let room=noteContext?MAX_NOTE_PHOTOS-attached().length:Infinity;
    if(noteContext){
      // Fingerprint photos already saved on this comment once, so re-picking one is caught after a reload too.
      await Promise.all(attachedPhotos().filter(photo=>!fingerprints.current.has(photo.id)).map(async photo=>{try{const {url}=await api.readPhoto(job.id,photo.id);fingerprints.current.set(photo.id,await contentHash(await (await fetch(url)).blob()));}catch{/* Unreadable photos just aren't compared. */}}));
    }
    for (const original of selected) {
      if(room<=0){setNotice(`You can add up to ${MAX_NOTE_PHOTOS} photos.`);break;}
      let file:File;
      try {file=await preparePhotoFile(original);}catch(error){setFileError(error instanceof ApiError?error:new ApiError('VALIDATION_ERROR','This photo could not be opened. Try a JPEG from your gallery.'));continue;}
      let hash:string|undefined;
      if(noteContext){
        hash=await contentHash(file);
        if([...fingerprints.current.values()].includes(hash)){setNotice('You’ve already added this photo.');continue;}
        room--;
      }
      const item:UploadItem={ id: crypto.randomUUID(), key: crypto.randomUUID(), finalizeKey: crypto.randomUUID(), file, category: selectedRoom?.type ?? category, roomId: selectedRoom?.id ?? (noteContext ? itemId : undefined), state: 'queued', progress: 0 };
      if(hash)fingerprints.current.set(item.id,hash);
      setQueue(items=>[...items,item]);
      void upload(item);
    }
    setPreparing(count=>count-1);
  }
  function attachedPhotos(){return collection.data?.filter(photo=>photo.state==='ready'&&!removed.has(photo.id)&&!queue.some(item=>item.ticket?.photoId===photo.id))??[];}
  function attached(){return [...queue.filter(item=>item.state!=='failed'&&(!item.ticket||!removed.has(item.ticket.photoId))),...attachedPhotos()];}
  async function removePhoto(photoId?:string,queueId?:string){
    if(removing||!canUpload)return;
    if(queueId)fingerprints.current.delete(queueId);if(photoId)fingerprints.current.delete(photoId);
    if(!photoId){setQueue(items=>items.filter(item=>item.id!==queueId));return;}
    setRemoving(photoId);setFileError(undefined);
    try{await request('/jobs/'+job.id+'/photos/'+photoId+'/remove',{body:{}});setRemoved(value=>new Set([...value,photoId]));setQueue(items=>items.filter(item=>item.id!==queueId&&item.ticket?.photoId!==photoId));collection.reload();}
    catch(error){setFileError(error);}finally{setRemoving(undefined);}
  }
  if(noteContext)return <>
    {pickerTarget&&canUpload&&integration.prepareUpload&&attached().length<MAX_NOTE_PHOTOS&&createPortal(<PhotoPicker iconOnly onFiles={files=>add(files)}/>,pickerTarget)}
    {previewTarget&&createPortal(<>
      {queue.filter(item=>!item.ticket||!removed.has(item.ticket.photoId)).map(item=><div key={item.id}>
        <NotePhotoPreview jobId={job.id} file={item.file} photoId={item.state==='ready'?item.ticket?.photoId:undefined} disabled={!canUpload||!!removing||item.state==='uploading'||item.state==='queued'} onRemove={canUpload?()=>void removePhoto(item.ticket?.photoId,item.id):undefined} status={item.state==='ready'?undefined:item.state==='failed'?'Upload failed':Math.round(item.progress)+'%'}/>
        {item.state==='failed'&&<ErrorNotice error={item.error} retry={canUpload?()=>void upload(item):undefined}/>}
      </div>)}
      {collection.data?.filter(photo=>photo.state==='ready'&&!removed.has(photo.id)&&!queue.some(item=>item.ticket?.photoId===photo.id)).map(photo=><NotePhotoPreview key={photo.id} jobId={job.id} photoId={photo.id} disabled={!!removing} onRemove={canUpload&&photo.uploaderId===user.id?()=>void removePhoto(photo.id):undefined}/>)}
    </>,previewTarget)}
    {notice&&<p role="status" className="bloom-photo-notice">{notice}</p>}
    {preparing>0&&<p role="status">Preparing photo…</p>}
    {!!collection.error&&<ErrorNotice error={collection.error} retry={collection.reload}/>}
    {!!fileError&&<ErrorNotice error={fileError}/>}
    {draftStorageError&&<p role="alert">Keep this window open until your photos finish uploading.</p>}
  </>;
  const uploader=(photo:JobPhoto)=>photo.uploaderId===user.id?'You':photo.uploaderName||integration.uploaderLabel?.(photo)||'Another cleaner';
  const shown=(roomId?:string)=>collection.data?.filter(photo=>!removed.has(photo.id)&&(roomId===undefined||photo.roomId===roomId))??[];
  const removable=(photo:JobPhoto)=>canUpload&&photo.uploaderId===user.id&&photo.state==='ready';
  const gallery=viewing?shown(viewing.group||undefined).filter(photo=>photo.state==='ready'):[];
  const lightbox=viewing&&gallery.length?<PhotoLightbox jobId={job.id} removing={!!removing} photos={gallery.map(photo=>({id:photo.id,label:`${categories[photo.category]} · ${uploader(photo)}`,removable:removable(photo)}))} index={Math.min(viewing.index,gallery.length-1)} onIndex={index=>setViewing({...viewing,index})} onRemove={photoId=>void removePhoto(photoId).then(()=>{if(gallery.length<=1)setViewing(null);})} onClose={()=>setViewing(null)}/>:null;
  return <section className={`info-row${noteContext?"":" bloom-photo-section"}`} aria-label={noteContext?noteContext+' note photos':'Room photos'}>
    {collection.loading && <Loading />}{!!collection.error && <ErrorNotice error={collection.error} retry={collection.reload} />}
    {collection.data && rooms && <><p>{rooms.filter(room=>collection.data!.some(photo=>photo.roomId===room.id&&photo.state==='ready')).length} of {rooms.length} rooms ready</p><div className="bloom-room-grid">{rooms.map(room=><section className="bloom-room-card" key={room.id}><h3>{room.label}</h3><p role="status">{queue.some(item=>item.roomId===room.id&&item.state==='ready')?<><span aria-hidden="true">✓ </span>Photo saved</>:collection.data!.some(photo=>photo.roomId===room.id&&photo.state==='ready')?'Ready':'Ready photo needed'}</p><div className="bloom-room-photos">{shown(room.id).map((photo,index)=><Photo key={photo.id} photo={photo} jobId={job.id} label={uploader(photo)} disabled={!!removing} removing={removing===photo.id} onOpen={()=>setViewing({group:room.id,index})} onRemove={removable(photo)?()=>void removePhoto(photo.id):undefined}/>)}</div>{canUpload&&integration.prepareUpload&&<PhotoPicker label={'Add photo to '+room.label} onFiles={files=>add(files,room)}/>}</section>)}</div></>}
    {collection.data && !rooms && <>{!noteContext&&<ul className="bloom-coverage">{(rooms ?? Object.entries(categories).map(([id,label]) => ({id,label}))).map(room => { const count = collection.data!.filter(photo => photo.state === 'ready' && (rooms ? photo.roomId === room.id : photo.category === room.id)).length; return <li key={room.id}>{room.label}: {count ? `${count} ready` : 'Needed'}</li>; })}</ul>}<div className="bloom-photos">{shown().map((photo,index) => <Photo key={photo.id} photo={photo} jobId={job.id} label={uploader(photo)} disabled={!!removing} removing={removing===photo.id} onOpen={()=>setViewing({group:'',index})} onRemove={removable(photo)?()=>void removePhoto(photo.id):undefined} />)}</div>{shown().length === 0 && <p>No photos yet.</p>}</>}
    {canUpload && !rooms && (integration.prepareUpload ? <div className="bloom-form">{!noteContext&&<label>Room category<Select value={category} onChange={event => setCategory(event.target.value as PhotoCategory)}>{Object.entries(categories).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</Select></label>}{pickerTarget?createPortal(<PhotoPicker iconOnly onFiles={files=>add(files)}/>,pickerTarget):<PhotoPicker onFiles={files=>add(files)}/>}</div> : <p className="window-note">Photo upload is not available yet. Contact your admin.</p>)}
    {draftStorageError && <p role="alert">Photo recovery storage is unavailable. Keep this window open until uploads finish; after closing it, failed files must be selected again.</p>}
    {preparing>0&&<p role="status">Preparing photos…</p>}
    {!!fileError && <ErrorNotice error={fileError} />}
    {lightbox}
    <div aria-live="polite">{queue.filter(item => item.state !== 'ready').map(item => <div className="bloom-upload" key={item.id}><span>{item.file.name} · {rooms?.find(room=>room.id===item.roomId)?.label ?? (noteContext?'Note attachment':categories[item.category])}</span><progress max="100" value={item.progress} aria-label={`Uploading ${item.file.name}`} /><span>{item.state === 'failed' ? 'Upload failed' : `${Math.round(item.progress)}%`}</span>{item.state === 'failed' && <ErrorNotice error={item.error} retry={canUpload ? () => void upload(item) : undefined} />}</div>)}</div>
  </section>;
}

export function CompletionPhotos({jobId,spaces}:{jobId:string;spaces?:{id:string;label:string}[]}) {
 const load=useCallback((signal:AbortSignal)=>api.photos(jobId,signal),[jobId]);
 const photos=useResource(load);
 const [viewing,setViewing]=useState<number|null>(null);
 const labelOf=(photo:JobPhoto)=>[spaces?.find(s=>s.id===photo.roomId)?.label,photo.uploaderName??'Cleaner'].filter(Boolean).join(' · ');
 const visible=photos.data?.filter(photo=>photo.state==='ready'&&!photo.noteContext&&(!spaces||spaces.some(s=>s.id===photo.roomId)))??[];
 return photos.loading?<Loading/>:photos.error?<ErrorNotice error={photos.error} retry={photos.reload}/>:<div className="bloom-room-grid">{visible.map((photo,index)=><Photo key={photo.id} photo={photo} jobId={jobId} label={labelOf(photo)} onOpen={()=>setViewing(index)}/>)}{!visible.length&&<p>No room photos were provided.</p>}{viewing!=null&&visible.length>0&&<PhotoLightbox jobId={jobId} photos={visible.map(photo=>({id:photo.id,label:`${categories[photo.category]} · ${labelOf(photo)}`}))} index={Math.min(viewing,visible.length-1)} onIndex={setViewing} onClose={()=>setViewing(null)}/>}</div>;
}
