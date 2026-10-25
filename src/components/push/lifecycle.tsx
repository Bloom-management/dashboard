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
 useEffect(()=>{
  if(!isLoaded||!userId)return;
  let busy=false;
  const controller=new AbortController();
  const reconcile=()=>{
   if(busy||document.visibilityState!=='visible')return;
   busy=true;
   void request('/push/device',{body:{},signal:controller.signal}).catch(()=>{}).finally(()=>{busy=false;});
  };
  reconcile();
  const interval=window.setInterval(reconcile,60000);
  window.addEventListener('online',reconcile);
  document.addEventListener('visibilitychange',reconcile);
  return()=>{controller.abort();window.clearInterval(interval);window.removeEventListener('online',reconcile);document.removeEventListener('visibilitychange',reconcile);};
 },[isLoaded,userId,sessionId]);
 return null;
}
