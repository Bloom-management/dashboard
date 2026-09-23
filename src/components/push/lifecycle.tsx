'use client';
import {useEffect} from 'react';
import {useAuth} from '@clerk/nextjs';
import {request} from '../bloom/api';
/** Runs on sign-in/out and account switching, including outside the Cleaner Hub.
 * Server checks the Clerk session again at send/display; this effect is not the security boundary. */
export function PushLifecycle(){
 const {isLoaded,userId,sessionId}=useAuth();
 useEffect(()=>{if(isLoaded)void request('/push/device',{body:{}}).catch(()=>{});},[isLoaded,userId,sessionId]);
 return null;
}
