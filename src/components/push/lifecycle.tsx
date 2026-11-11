'use client';
import {useEffect} from 'react';
/** Refresh the worker without changing any account/device connections. */
export function PushLifecycle(){
 useEffect(()=>{
  if(!('serviceWorker' in navigator))return;
  const update=()=>{if(document.visibilityState==='visible')for(const scope of ['/push/','/bloom-push/'])void navigator.serviceWorker.getRegistration(scope).then(registration=>registration?.update()).catch(()=>{});};
  update();document.addEventListener('visibilitychange',update);
  return()=>document.removeEventListener('visibilitychange',update);
 },[]);
 return null;
}
