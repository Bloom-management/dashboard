'use client';
import {useCallback,useEffect,useRef,useState,type Dispatch,type SetStateAction} from 'react';
import {ApiError,request} from './api';
import {ErrorNotice,useResource} from './primitives';
import type {JourneyDraft} from './journey-draft';

type SharedDraft=Pick<JourneyDraft,'answers'|'notes'|'maintenance'|'guestReview'|'version'|'reviewed'>;
type Handoff={revision:number;draft:SharedDraft|null;senderId:string|null;senderName:string|null;missing:string[]};
export function CleaningHandoff({jobId,userId,configVersion,hasTeammate,started,disabled,draft,setDraft,onBusy}:{jobId:string;userId:string;configVersion:number;hasTeammate:boolean;started:boolean;disabled:boolean;draft:JourneyDraft;setDraft:Dispatch<SetStateAction<JourneyDraft>>;onBusy:(busy:boolean)=>void}) {
 const load=useCallback((signal:AbortSignal)=>request<Handoff>(`/jobs/${jobId}/handoff`,{signal}),[jobId]);
 const shared=useResource(load,true);
 const [error,setError]=useState<unknown>();
 const [message,setMessage]=useState('');
 const [previous,setPrevious]=useState<JourneyDraft>();
 const lock=useRef(false);
 const backupKey=`bloom-journey:${userId}:${jobId}:before-handoff`;
 useEffect(()=>{try{const saved=localStorage.getItem(backupKey);if(saved){const value=JSON.parse(saved);if(value&&typeof value.notes==='string'&&value.answers)setPrevious(value);}}catch{/* Backup is optional; shared progress remains on the server. */}},[backupKey]);
 useEffect(()=>{const refresh=()=>shared.reload();window.addEventListener('focus',refresh);const timer=setInterval(refresh,15000);return()=>{window.removeEventListener('focus',refresh);clearInterval(timer);};},[shared.reload]);
 const newer=!!shared.data?.draft&&shared.data.revision>(draft.handoffRevision??0);
 async function send(){
  if(lock.current||!shared.data)return;
  const operation=draft.pendingHandoff??{key:crypto.randomUUID(),revision:draft.handoffRevision??0,draft:{version:configVersion,answers:draft.answers,notes:draft.notes,maintenance:draft.maintenance??{},reviewed:draft.reviewed??[],...(draft.guestReview?{guestReview:draft.guestReview}:{})}};
  lock.current=true;onBusy(true);setError(undefined);setMessage('');
  try{
   // Save the exact operation before sending, so network retries cannot send twice.
   const next={...draft,pendingHandoff:operation};
   localStorage.setItem(`bloom-journey:${userId}:${jobId}`,JSON.stringify(next));setDraft(next);
   const result=await request<Handoff>(`/jobs/${jobId}/handoff`,{body:{draft:operation.draft,revision:operation.revision},key:operation.key});
   setDraft(value=>({...value,pendingHandoff:undefined,handoffRevision:result.revision}));
   setMessage('Progress saved. Your teammate has been asked to finish.');shared.reload();
  }catch(e){setError(e);if(e instanceof ApiError&&['CONFLICT','VALIDATION_ERROR','INVALID_STATE','NOT_FOUND','FORBIDDEN','REVIEW_REQUIRED'].includes(e.code)){setDraft(value=>({...value,pendingHandoff:undefined}));shared.reload();}}
  finally{lock.current=false;onBusy(false);}
 }
 return <section className="bloom-handoff" aria-label="Shared cleaning progress">
 {newer&&<><h3>{shared.data?.senderId===userId?'Your saved handoff':'Your teammate’s saved progress'}</h3><p>{shared.data?.senderName} saved photos and checklist information. Load it to continue this cleaning.</p>{!!shared.data?.missing.length?<><p>Still needed:</p><ul>{shared.data.missing.map((item,index)=><li key={`${index}:${item}`}>{item}</li>)}</ul></>:<p>Ready for a final review and submission.</p>}<p>Loading replaces your unsent checklist answers. You can restore them below.</p><button type="button" className="bloom-button secondary" disabled={disabled||!!draft.pendingHandoff} onClick={()=>{if(!shared.data?.draft)return;try{localStorage.setItem(backupKey,JSON.stringify(draft));}catch{setError(new Error('Could not back up your unsent answers. Free device storage and try again.'));return;}setPrevious(draft);setDraft({...shared.data.draft,step:shared.data.missing.some(item=>item.startsWith('Photo:'))?'photos':shared.data.missing.includes('Supplies check')?'supplies':shared.data.missing.some(item=>item.startsWith('Maintenance'))?'maintenance':'guest',handoffRevision:shared.data.revision});setMessage('Shared progress loaded. Review it and fill in the remaining items.');}}>Use shared progress</button></>}
 {previous&&<button type="button" className="bloom-button secondary" disabled={disabled} onClick={()=>{setDraft(previous);setPrevious(undefined);try{localStorage.removeItem(backupKey);}catch{/* Restored draft is retained by the journey. */}setMessage('Your unsent answers were restored. Load shared progress again before submitting.');}}>Restore my previous draft</button>}
 {hasTeammate&&started&&<><button type="button" className="bloom-button secondary" disabled={disabled||shared.loading||!!shared.error||(newer&&!draft.pendingHandoff)} onClick={()=>void send()}>{draft.pendingHandoff?'Retry teammate request':'Ask teammate to finish'}</button><p>Saves your checklist answers and sends your teammate the remaining steps. Either cleaner can submit.</p></>}
 {!!shared.error&&<ErrorNotice error={shared.error} retry={shared.reload}/>}
 {!!error&&<><ErrorNotice error={error}/>{error instanceof ApiError&&error.code==='CONFLICT'&&<p>Load newer shared progress before trying again. If you just sent a request, wait one minute before sending another.</p>}</>}
 {message&&<p role="status">{message}</p>}
 </section>;
}
