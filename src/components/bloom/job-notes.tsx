'use client';
import {useCallback,useEffect,useImperativeHandle,useRef,useState,type Ref} from 'react';
import type {CleanerJob,SessionUser} from '../../contracts';
import type {BloomIntegration} from './integration';
import {request,api} from './api';
import {Photos,Photo} from './photos';
import {ErrorNotice,Loading,useResource} from './primitives';
import styles from './cleaner-journey.module.css';
type Note={authorId:string;authorName:string;body:string;updatedAt:string};
export type SupplyNotesHandle={save:()=>Promise<boolean>};
export function SupplyNotes({job,user,integration,disabled=false,onPendingChange,controller}:{controller?:Ref<SupplyNotesHandle>;onPendingChange?:(pending:boolean)=>void;job:CleanerJob;user:SessionUser;integration:BloomIntegration;disabled?:boolean}){
 const path='/jobs/'+job.id+'/notes',storageKey='bloom-supply-note:'+job.id+':'+user.id;
 const load=useCallback((signal:AbortSignal)=>request<Note[]>(path+'?section=supplies',{signal}),[path]);
 const notes=useResource(load,true),initialized=useRef(false),lock=useRef(false);
 const [body,setBody]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
 const [previewTarget,setPreviewTarget]=useState<HTMLDivElement|null>(null);
 const [pickerTarget,setPickerTarget]=useState<HTMLDivElement|null>(null);
 const receipt=useRef<{body:string;key:string}|undefined>(undefined);
 useEffect(()=>{if(initialized.current||!notes.data)return;initialized.current=true;let draft:string|null=null;try{draft=localStorage.getItem(storageKey);}catch{}setBody(draft??notes.data.find(n=>n.authorId===user.id)?.body??'');},[notes.data,user.id,storageKey]);
 async function save(){if(lock.current||!initialized.current)return false;lock.current=true;setBusy(true);setError(undefined);
 if(receipt.current?.body!==body)receipt.current={body,key:crypto.randomUUID()};
 try{await request(path,{body:{section:'supplies',body},key:receipt.current.key});receipt.current=undefined;try{localStorage.removeItem(storageKey);}catch{}notes.reload();return true;}catch(e){setError(e);return false;}finally{lock.current=false;setBusy(false);}}
 useImperativeHandle(controller,()=>({save}));
 return <section aria-label="Supply notes"><div className={styles.notes}><label htmlFor="supply-note-text">Anything else about supplies? <span>Optional</span></label><div className={styles.noteBox}><div ref={setPreviewTarget} className={styles.noteAttachments}/><textarea id="supply-note-text" maxLength={1500} disabled={disabled||busy||!notes.data} value={body} onChange={e=>{setBody(e.target.value);try{localStorage.setItem(storageKey,e.target.value);}catch{}}}/><div ref={setPickerTarget} className={styles.noteCamera}/></div></div>
 {!!error&&<ErrorNotice error={error}/>}
 {!!notes.error&&<ErrorNotice error={notes.error} retry={notes.reload}/>}
 {notes.data?.filter(n=>n.authorId!==user.id&&n.body).map(n=><p key={n.authorId}><strong>{n.authorName}: </strong>{n.body}</p>)}
 <Photos job={job} user={user} integration={integration} locked={disabled} noteContext="supplies" pickerTarget={pickerTarget} previewTarget={previewTarget} onPendingChange={onPendingChange}/>
 </section>;
}
export function NoteReport({jobId,section}:{jobId:string;section:'supplies'|'maintenance'}){
 const load=useCallback(async(signal:AbortSignal)=>({notes:await request<Note[]>('/jobs/'+jobId+'/notes?section='+section,{signal}),photos:(await api.photos(jobId,signal)).filter(p=>p.noteContext===section&&p.state==='ready'&&!p.roomId)}),[jobId,section]);
 const data=useResource(load,true);
 return data.loading?<Loading/>:data.error?<ErrorNotice error={data.error} retry={data.reload}/>:<section aria-label={section+' notes and photos'}>
 {data.data?.notes.filter(n=>n.body).map(n=><div key={n.authorId}><strong>{n.authorName}</strong><p className="bloom-prewrap">{n.body}</p></div>)}
 <div className="bloom-photo-strip">{data.data?.photos.map(p=><Photo key={p.id} photo={p} jobId={jobId} label={p.uploaderName??'Cleaner'}/>)}</div></section>;
}
