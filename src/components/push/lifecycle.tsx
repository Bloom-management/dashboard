'use client';
import {useEffect} from 'react';
import {useAuth} from '@clerk/nextjs';
import {request} from '../bloom/api';
/** Remember authenticated accounts on an already verified device. Logout retains consent. */
export function PushLifecycle(){
 const {isLoaded,userId,sessionId}=useAuth();
 useEffect(()=>{
  if(!('serviceWorker' in navigator))return;
  const update=()=>{if(document.visibilityState==='visible')void navigator.serviceWorker.getRegistration('/push/').then(registration=>registration?.update()).catch(()=>{});};
  update();document.addEventListener('visibilitychange',update);
  return()=>document.removeEventListener('visibilitychange',update);
 },[]);
 useEffect(()=>{if(isLoaded)void request('/push/device',{body:{}}).catch(()=>{});},[isLoaded,userId,sessionId]);
 return null;
}
