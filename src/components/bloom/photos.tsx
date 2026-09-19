'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CleanerJob, CleaningRoom, JobPhoto, PhotoCategory, SessionUser } from '../../contracts';
import { api, ApiError } from './api';
import type { BloomIntegration, UploadTicket } from './integration';
import { ErrorNotice, Loading, useResource } from './primitives';
import { readPhotoDrafts, writePhotoDrafts } from './photo-drafts';

export const categories: Record<PhotoCategory, string> = { bedrooms: 'Bedrooms', bathrooms: 'Bathrooms', kitchen: 'Kitchen', living_room: 'Living room' };
type UploadItem = { roomId?: string; id: string; file: File; category: PhotoCategory; key: string; finalizeKey: string; ticket?: UploadTicket; uploaded?: boolean; progress: number; state: 'queued' | 'uploading' | 'failed' | 'ready'; error?: unknown };

function Photo({ photo, jobId, label }: { photo: JobPhoto; jobId: string; label: string }) {
  const [read, setRead] = useState<{ url: string; expiresAt: string }>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!read) return;
    const timer = window.setTimeout(() => setRead(undefined), Math.max(0, Date.parse(read.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [read]);
  async function view() {
    if (busy) return;
    setBusy(true); setError(undefined);
    try { const result = await api.readPhoto(jobId, photo.id); if (mounted.current) setRead(result); }
    catch (failure) { if (mounted.current) { setRead(undefined); setError(failure); } }
    finally { if (mounted.current) setBusy(false); }
  }
  return <figure className="bloom-photo">{read ? <img src={read.url} alt={`${categories[photo.category]}, uploaded by ${label}`} onError={() => { setRead(undefined); setError(new ApiError('SOURCE_UNAVAILABLE', 'Photo link expired or unavailable. Try again.')); }} /> : <button className="bloom-button" onClick={view} disabled={busy || photo.state !== 'ready'}>{busy ? 'Opening…' : photo.state === 'ready' ? 'View photo' : 'Upload pending'}</button>}<figcaption>{categories[photo.category]} · {label}{photo.state === 'ready' && <span aria-label="Photo saved"> · ✓</span>}</figcaption>{!!error && <ErrorNotice error={error} retry={view} />}</figure>;
}

export function Photos({ job, user, integration, onCoverage, rooms, locked = false }: { rooms?: CleaningRoom[]; locked?: boolean; job: CleanerJob; user: SessionUser; integration: BloomIntegration; onCoverage?: (complete: boolean) => void }) {
  const loader = useCallback((signal: AbortSignal) => api.photos(job.id, signal), [job.id]);
  const collection = useResource(loader);
  const [category, setCategory] = useState<PhotoCategory>('bedrooms');
  const [queue, setQueue] = useState<UploadItem[]>([]);
  const [fileError, setFileError] = useState<unknown>();
  const [draftsReady,setDraftsReady]=useState(false);
  const [draftStorageError,setDraftStorageError]=useState(false);
  const draftKey=`${user.id}:${job.id}`;
  useEffect(()=>{let current=true;void readPhotoDrafts<UploadItem>(draftKey).then(items=>{if(current)setQueue(items.map(item=>({...item,state:'failed',error:new ApiError('NETWORK_ERROR','Saved upload restored. Retry to resume this photo.')})));}).catch(()=>{if(current)setDraftStorageError(true);}).finally(()=>{if(current)setDraftsReady(true);});return()=>{current=false;};},[draftKey]);
  useEffect(()=>{if(draftsReady)void writePhotoDrafts(draftKey,queue.filter(item=>item.state!=='ready').map(({ticket:_ticket,error:_error,...item})=>item)).catch(()=>setDraftStorageError(true));},[queue,draftsReady,draftKey]);
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
    const timer = window.setInterval(collection.reload, 30000);
    return () => clearInterval(timer);
  }, [collection.reload]);
  useEffect(() => {
    onCoverage?.(!!collection.data && (rooms ? rooms.every(room => collection.data!.some(photo => photo.roomId === room.id && photo.state === 'ready')) : Object.keys(categories).every(category => collection.data!.some(photo => photo.category === category && photo.state === 'ready'))));
  }, [collection.data, onCoverage, rooms]);
  function update(id: string, patch: Partial<UploadItem>) { setQueue(items => items.map(item => item.id === id ? { ...item, ...patch } : item)); }
  async function upload(item: UploadItem) {
    if (!integration.prepareUpload || !allowed.current || active.current.has(item.id)) return;
    active.current.add(item.id);
    const controller = new AbortController(); controllers.current.add(controller);
    update(item.id, { state: 'uploading', error: undefined });
    try {
      // Persist the ticket and stage across retries, including an uncertain finalize response.
      const ticket = item.ticket ?? await integration.prepareUpload(job.id, item.category, item.file, item.key, controller.signal, item.roomId);
      if (controller.signal.aborted) return;
      update(item.id, { ticket });
      if (!item.uploaded) {
        await ticket.upload(item.file, progress => update(item.id, { progress }), controller.signal);
        if (controller.signal.aborted) return;
        update(item.id, { uploaded: true, progress: 100 });
      }
      await api.finalize(job.id, ticket.photoId, item.finalizeKey);
      if (!controller.signal.aborted) { update(item.id, { state: 'ready' }); collection.reload(); }
    } catch (error) {
      if (!controller.signal.aborted) {
        update(item.id, { state: 'failed', error });
        if (error instanceof ApiError && ['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'].includes(error.code)) collection.reload();
      }
    }
    finally { controllers.current.delete(controller); active.current.delete(item.id); }
  }
  function add(files: FileList | null, selectedRoom?: CleaningRoom) {
    if (!files) return;
    setFileError(undefined);
    const valid: UploadItem[] = [];
    for (const file of Array.from(files)) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024 || !file.size) {
        setFileError(new ApiError('VALIDATION_ERROR', 'Choose JPEG, PNG, or WebP photos up to 10 MB each.')); continue;
      }
      valid.push({ id: crypto.randomUUID(), key: crypto.randomUUID(), finalizeKey: crypto.randomUUID(), file, category: selectedRoom?.type ?? category, roomId: selectedRoom?.id, state: 'queued', progress: 0 });
    }
    setQueue(items => [...items, ...valid]);
    // Serial per selection; multiple cleaners still share the backend collection.
    void (async () => { for (const item of valid) await upload(item); })();
  }
  return <section className="info-row" aria-label="Shared completion photos"><h3 className="row-head">Shared photos</h3><p className="window-note">{rooms ? `Each of the ${rooms.length} configured rooms needs a ready photo. About eight photos is guidance, not a limit.` : 'Shared completion photos. Legacy category photos do not establish coverage of individual rooms.'}</p>
    {collection.loading && <Loading />}{!!collection.error && <ErrorNotice error={collection.error} retry={collection.reload} />}
    {collection.data && rooms && <><p>{rooms.filter(room=>collection.data!.some(photo=>photo.roomId===room.id&&photo.state==='ready')).length} of {rooms.length} rooms ready</p><div className="bloom-room-grid">{rooms.map(room=><section className="bloom-room-card" key={room.id}><h3>{room.label}</h3><p role="status">{queue.some(item=>item.roomId===room.id&&item.state==='ready')?<><span aria-hidden="true">✓ </span>Photo saved</>:collection.data!.some(photo=>photo.roomId===room.id&&photo.state==='ready')?'Ready':'Ready photo needed'}</p><div className="bloom-room-photos">{collection.data!.filter(photo=>photo.roomId===room.id).map(photo=><Photo key={photo.id} photo={photo} jobId={job.id} label={photo.uploaderId===user.id?'You':photo.uploaderName||integration.uploaderLabel?.(photo)||'Another cleaner'}/>)}</div>{canUpload&&integration.prepareUpload&&<label className="bloom-room-upload">Add photos to {room.label}<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event=>{add(event.target.files,room);event.target.value='';}}/></label>}</section>)}</div></>}
    {collection.data && !rooms && <><ul className="bloom-coverage">{(rooms ?? Object.entries(categories).map(([id,label]) => ({id,label}))).map(room => { const count = collection.data!.filter(photo => photo.state === 'ready' && (rooms ? photo.roomId === room.id : photo.category === room.id)).length; return <li key={room.id}>{room.label}: {count ? `${count} ready` : 'Needed'}</li>; })}</ul><div className="bloom-photos">{collection.data.map(photo => <Photo key={photo.id} photo={photo} jobId={job.id} label={photo.uploaderId === user.id ? 'You' : photo.uploaderName || integration.uploaderLabel?.(photo) || 'Another cleaner'} />)}</div>{collection.data.length === 0 && <p>No photos yet.</p>}</>}
    {canUpload && !rooms && (integration.prepareUpload ? <div className="bloom-form"><label>Room category<select value={category} onChange={event => setCategory(event.target.value as PhotoCategory)}>{Object.entries(categories).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><label>Add photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => { add(event.target.files); event.target.value = ''; }} /></label></div> : <p className="window-note">Photo upload is not available yet. Contact your admin.</p>)}
    {draftStorageError && <p role="alert">Photo recovery storage is unavailable. Keep this window open until uploads finish; after closing it, failed files must be selected again.</p>}
    {!!fileError && <ErrorNotice error={fileError} />}
    <div aria-live="polite">{queue.filter(item => item.state !== 'ready').map(item => <div className="bloom-upload" key={item.id}><span>{item.file.name} · {rooms?.find(room=>room.id===item.roomId)?.label ?? categories[item.category]}</span><progress max="100" value={item.progress} aria-label={`Uploading ${item.file.name}`} /><span>{item.state === 'failed' ? 'Upload failed' : `${Math.round(item.progress)}%`}</span>{item.state === 'failed' && <ErrorNotice error={item.error} retry={canUpload ? () => void upload(item) : undefined} />}</div>)}</div>
  </section>;
}
