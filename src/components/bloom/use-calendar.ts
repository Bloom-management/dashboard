'use client';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { ApiError } from './api';
import { CalendarCache } from './calendar-cache';

export function useCalendar<T>(scope: string, path: string, prefetchPaths: readonly string[] = []) {
  const cache=useMemo(()=>new CalendarCache<T>(async(key,etag,signal)=>{
    const response=await fetch(`/api${key}`,{credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:etag?{'If-None-Match':etag}:undefined});
    if(response.status===304)return {unchanged:true};
    const body=await response.json().catch(()=>null);
    if(!response.ok||!body||!('data' in body))throw new ApiError(body?.error?.code ?? (response.status===401?'UNAUTHENTICATED':response.status===403?'FORBIDDEN':'SOURCE_UNAVAILABLE'),body?.error?.message??'Calendar unavailable. Try again.',body?.error?.requestId);
    return {data:body.data as T,etag:response.headers.get('etag')??undefined};
  }),[scope]); // scope deliberately recreates all state when identity, role or approved city changes.
  const prefetchKey = JSON.stringify(prefetchPaths);
  const snapshot=useCallback(()=>cache.entry(path),[cache,path]);
  const state=useSyncExternalStore(cache.subscribe,snapshot,snapshot);
  useEffect(()=>{void cache.load(path);},[cache,path]);
  useEffect(() => {
    for (const nextPath of JSON.parse(prefetchKey) as string[]) void cache.load(nextPath);
  }, [cache, prefetchKey]);
  useEffect(()=>{
    // Only conditional checks run in the background; 304 never redraws the calendar.
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')cache.check();},30000);
    return ()=>{window.clearInterval(timer);cache.dispose();};
  },[cache]);
  const reload=useCallback(()=>cache.check(),[cache]);
  return {...state,reload};
}
