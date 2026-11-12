'use client';
import {useCallback,useEffect,useState} from 'react';
import {DEFAULT_AVATAR} from '../../lib/avatar';
import {request} from './api';
import {useResource} from './primitives';
export type CleanerIdentity={id:string;displayName:string;avatarUrl?:string|null;slot?:number};
/** `poll` refreshes on focus and every 30s; list cards pass false and refresh only when the job version changes. */
export function useJobTeam(jobId:string,version:number,poll=true){
 const load=useCallback((signal:AbortSignal)=>request<CleanerIdentity[]>(`/jobs/${jobId}/team`,{signal}),[jobId]);
 const result=useResource(load,true);
 useEffect(()=>{result.reload();},[version,result.reload]);
 useEffect(()=>{if(!poll)return;const refresh=()=>{if(document.visibilityState==='visible')result.reload();};window.addEventListener('focus',refresh);const timer=setInterval(refresh,30000);return()=>{window.removeEventListener('focus',refresh);clearInterval(timer);};},[poll,result.reload]);
 return result;
}
export function CleanerAvatar({name,url}:{name:string;url?:string|null}){
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[url]);
 return <img src={!failed&&url?url:DEFAULT_AVATAR} alt="" title={name} onError={()=>setFailed(true)} style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'50%'}}/>;
}
