'use client';
import {useCallback,useRef,useState} from 'react';
import {SignIn,SignUp} from '@clerk/nextjs';
import {useRouter} from 'next/navigation';
import type {IncomingTeamInvitation} from '@/contracts/cleaning-teams';
import {request} from './api';
import {ErrorNotice,Loading,useResource} from './primitives';

export function IncomingTeamInvitations(){
 const router=useRouter();const load=useCallback((signal:AbortSignal)=>request<{items:IncomingTeamInvitation[]}>('/cleaner/team-invitations',{signal}),[]);const data=useResource(load);
 const[busy,setBusy]=useState<string|null>(null);const[error,setError]=useState<unknown>();const lock=useRef(false);const keys=useRef(new Map<string,string>());
 async function accept(id:string){if(lock.current)return;lock.current=true;setBusy(id);setError(undefined);const key=keys.current.get(id)??crypto.randomUUID();keys.current.set(id,key);
  try{await request(`/cleaner/team-invitations/${id}/accept`,{body:{},key});router.push('/');router.refresh();}catch(failure){setError(failure);}finally{lock.current=false;setBusy(null);}
 }
 if(data.loading)return <Loading/>;if(data.error)return <ErrorNotice error={data.error} retry={data.reload}/>;
 return <>{!data.data?.items.length&&<p>No cleaning team invitations match your verified email.</p>}{data.data?.items.map(invite=><section className="bloom-admin-card" key={invite.id}><h2>{invite.propertyName}</h2><p>{invite.status==='pending'?'You’ve been invited to clean this property. Joining this team does not enroll you in Bloom’s cleaner network.':`Invitation ${invite.status}.`}</p>{invite.status==='pending'&&<button className="bloom-button" disabled={busy!==null} onClick={()=>void accept(invite.id)}>{busy===invite.id?'Accepting…':'Accept invitation'}</button>}{invite.status==='accepted'&&<a href="/">Open my workspace</a>}</section>)}{!!error&&<ErrorNotice error={error}/>}</>;
}
export function TeamInvitationEntry({signedIn}:{signedIn:boolean}){
 const[existing,setExisting]=useState(false);
 return <main className="bloom-owner" style={{minHeight:'100dvh',padding:'32px 20px'}}><div className="bloom-admin-card" style={{maxWidth:620,margin:'0 auto'}}><h1>Your cleaning team invitation</h1>{signedIn?<><IncomingTeamInvitations/><a href="/">Return to your hub</a></>:<><p>Use your invited email to sign in or create an account. Access is limited to the invited property.</p><button className="bloom-button secondary" onClick={()=>setExisting(!existing)}>{existing?'Create an account':'Already have an account? Sign in'}</button>{existing?<SignIn routing="hash" forceRedirectUrl="/team-invitations"/>:<SignUp routing="hash" forceRedirectUrl="/team-invitations" signInUrl="/sign-in?redirect_url=%2Fteam-invitations"/>}</>}</div></main>;
}
