'use client';
import {useCallback,useRef,useState} from 'react';
import {request,ApiError} from './api';
import {ErrorNotice,Loading,useResource} from './primitives';
import {PeoplePage} from './people-page';
export function ResendInvite({email,path,invitationId,onSent}:{email:string;path:string;invitationId?:string;onSent:()=>void}){
 const[busy,setBusy]=useState(false),[sent,setSent]=useState(false),[error,setError]=useState<unknown>();const locked=useRef(false);const key=useRef<string|null>(null);
 return <><button type="button" className="bloom-button secondary" disabled={busy||sent} onClick={async()=>{if(locked.current)return;locked.current=true;setBusy(true);setError(undefined);key.current??=crypto.randomUUID();try{await request(path,{body:invitationId?{email,invitationId}:{email,resend:true},key:key.current});setSent(true);onSent();}catch(error){setError(error);}finally{locked.current=false;setBusy(false);}}}>{busy?'Sending…':sent?'Invite resent':'Resend invite'}</button>{sent&&<span role="status">Invitation sent.</span>}{error instanceof ApiError&&error.code==='CONFLICT'?<p role="alert">Wait a minute before resending. If they already joined, refresh People to see their account.</p>:!!error&&<ErrorNotice error={error}/>}</>;
}
export function PendingInvitations({revision}:{revision:number}){
 const load=useCallback((signal:AbortSignal)=>{void revision;return request<{id:string;email:string;role:string|null}[]>('/admin/invitations',{signal});},[revision]);const data=useResource(load);
 return <section aria-label="Pending invitations"><h3>Pending invitations</h3>{data.loading?<Loading/>:data.error?<ErrorNotice error={data.error} retry={data.reload}/>:data.data?.length?<PeoplePage items={data.data} label="Pending invitations">{items=><div className="admin-people-table-scroll"><table className="admin-people-table"><thead><tr><th>Email</th><th>Role</th><th>Invitation</th></tr></thead><tbody>{items.map(invite=><tr key={invite.id}><td>{invite.email} <span className="bloom-pending-label">Pending</span></td><td>{invite.role??'Not specified'}</td><td>{<ResendInvite email={invite.email} invitationId={invite.id} path="/admin/invitations" onSent={()=>{}}/>}</td></tr>)}</tbody></table></div>}</PeoplePage>:<p>No pending invitations.</p>}</section>;
}
