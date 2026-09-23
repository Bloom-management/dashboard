'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {request} from '../bloom/api';
export function VerifyPush(){const [message,setMessage]=useState('Verifying this device…');const started=useRef(false);useEffect(()=>{if(started.current)return;started.current=true;const proof=location.hash.slice(1);history.replaceState(null,'','/notifications/verify');void request('/push/verify',{body:{proof}}).then(()=>setMessage('Job notifications are enabled on this device. Choose the alerts you want in Notification settings.')).catch(()=>setMessage('Verification expired or this device is signed into a different account. Return to Notification settings and enable again.'));},[]);return <main className="bloom-push-card"><h1>Bloom Cleaning</h1><p role="status">{message}</p><Link href="/cleaner?notifications=1">Return to job notifications</Link></main>;}
