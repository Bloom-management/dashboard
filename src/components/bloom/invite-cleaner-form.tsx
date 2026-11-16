'use client';
import {useId,useRef,useState} from 'react';
import {ApiError,request} from './api';
import {OutlineButton} from './outline-button';
import {ErrorNotice} from './primitives';
import styles from './invite-cleaner-form.module.css';
/** Mounted beside listing creation: failed delivery never retries creating the listing. */
export function InviteCleanerForm({propertyId,email:initialEmail='',onDone,onEmailChange}:{propertyId:string;email?:string;onDone?:()=>void;onEmailChange?:(value:string)=>void}){
 const[email,setEmail]=useState(initialEmail);const[busy,setBusy]=useState(false);const[error,setError]=useState<unknown>();const[sent,setSent]=useState(false);
 const inputId=useId();
 const attempt=useRef<{email:string;key:string}|null>(null);const lock=useRef(false);
 async function send(event:React.FormEvent){event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);
  if(!attempt.current)attempt.current={email:email.trim(),key:crypto.randomUUID()};
  try{await request(`/properties/${propertyId}/cleaner-invitations`,{body:{email:attempt.current.email},key:attempt.current.key});setSent(true);attempt.current=null;onDone?.();}catch(failure){setError(failure);if(failure instanceof ApiError&&['VALIDATION_ERROR','FORBIDDEN','NOT_FOUND'].includes(failure.code))attempt.current=null;}finally{lock.current=false;setBusy(false);}
 }
 return <section><h3>Would you like to invite a cleaner?</h3>{sent?<p role="status">Invitation sent. This cleaner can access only this property after accepting.</p>:<form className="bloom-form" onSubmit={send}><label htmlFor={inputId}>Cleaner email</label><div className={styles.row}><input id={inputId} className={styles.input} type="email" required maxLength={254} autoComplete="email" value={email} disabled={busy||!!attempt.current} onChange={e=>{setEmail(e.target.value);onEmailChange?.(e.target.value);}}/><OutlineButton className={styles.button} type="submit" disabled={busy}>{busy?'Sending…':attempt.current?'Retry invitation':'Invite cleaner'}</OutlineButton></div>{!!error&&<><p>Your listing is saved. Retry this invitation without creating another listing.</p><ErrorNotice error={error}/></>}</form>}</section>;
}
