'use client';
import {useId,useState} from 'react';
import type {CleanerJob,SessionUser} from '../../contracts';
import type {BloomIntegration} from './integration';
import {Photos} from './photos';
import styles from './cleaner-journey.module.css';

/** Guest comment with photo attachments, shown as chat-style previews like the other note boxes. */
export function GuestComment({job,user,integration,value,onChange,disabled=false,onPendingChange}:{job:CleanerJob;user:SessionUser;integration:BloomIntegration;value:string;onChange:(value:string)=>void;disabled?:boolean;onPendingChange?:(pending:boolean)=>void}){
 const id=useId();
 const [picker,setPicker]=useState<HTMLDivElement|null>(null),[preview,setPreview]=useState<HTMLDivElement|null>(null);
 return <div className={styles.notes}>
  <label htmlFor={id}>Guest comment (optional)</label>
  <div className={styles.noteBox}><div ref={setPreview} className={styles.noteAttachments}/><textarea id={id} maxLength={1500} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}/><div ref={setPicker} className={styles.noteCamera}/></div>
  <Photos job={job} user={user} integration={integration} locked={disabled} noteContext="guest" pickerTarget={picker} previewTarget={preview} onPendingChange={onPendingChange}/>
 </div>;
}
