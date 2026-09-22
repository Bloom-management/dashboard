'use client';
import { useRef,useState } from 'react';
import type { Role } from '../../contracts';
import { request,ApiError } from './api';
import { ErrorNotice } from './primitives';

export function InvitePerson({onSent}:{onSent?:()=>void}){
 const [email,setEmail]=useState(''),[role,setRole]=useState<Role>('owner');
 const [busy,setBusy]=useState(false),[sent,setSent]=useState(''),[error,setError]=useState<unknown>();
 const lock=useRef(false);const receipt=useRef<{input:string;key:string} | null>(null);
 return <form className="bloom-admin-card bloom-form" onSubmit={async event=>{
  event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);setSent('');
  const body={email:email.trim().toLowerCase(),role},input=JSON.stringify(body);
  if(receipt.current?.input!==input)receipt.current={input,key:crypto.randomUUID()};
  try{
   const result=await request<{status:string}>('/admin/invitations',{body,key:receipt.current.key});
   setSent(result.status==='accepted'?'This invitation has already been accepted.':`Invitation sent to ${body.email} as ${role}.`);setEmail('');receipt.current=null;onSent?.();
  }catch(failure){setError(failure);}finally{lock.current=false;setBusy(false);}
 }}>
 <h2>Invite people</h2><div className="admin-invite-fields">
 <label>Email address<input type="email" required maxLength={254} placeholder="name@example.com" autoComplete="email" disabled={busy} value={email} onChange={event=>setEmail(event.target.value)}/></label>
 <label>Role<select aria-label="Invitation role" disabled={busy} value={role} onChange={event=>setRole(event.target.value as Role)}><option value="owner">Owner</option><option value="cleaner">Cleaner</option><option value="admin">Admin</option></select></label>
 <button type="submit" className="bloom-button" disabled={busy||!email.trim()}>{busy?'Sending…':'Send invite'}</button>
 </div>{sent&&<p role="status">{sent}</p>}{error instanceof ApiError&&error.code==='CONFLICT'?<p role="alert">This email already has an account or invitation. Manage an existing account below, or check the pending invitation.</p>:!!error&&<ErrorNotice error={error}/>}
 </form>;
}
