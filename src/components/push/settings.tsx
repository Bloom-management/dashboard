'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ApiError,request} from '../bloom/api';
import {Modal} from '../bloom/primitives';
import {deviceSupport,loadPush,type PushSDK} from './sdk';
type Settings={verified:boolean;pending:boolean;newJobs:boolean;reminders:boolean;configured:boolean;appId:string|null};
export function PushSettings(){
 const [open,setOpen]=useState(false),[status,setStatus]=useState<Settings>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[sdkReady,setSdkReady]=useState(false),[sdkEnabled,setSdkEnabled]=useState(false);
 const [support,setSupport]=useState<ReturnType<typeof deviceSupport>>(),[permission,setPermission]=useState<NotificationPermission>('default');const sdk=useRef<PushSDK>(null),lock=useRef(false);
 const refresh=useCallback(async()=>{const value=await request<Settings>('/push/settings');setStatus(value);setPermission('Notification' in window?Notification.permission:'default');return value;},[]);
 useEffect(()=>{setSupport(deviceSupport());setOpen(new URLSearchParams(location.search).get('notifications')==='1');void refresh().catch(()=>setError('Notification settings could not load. Please retry.'));const focus=()=>void refresh().catch(()=>{});window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[refresh]);
 useEffect(()=>{if(!status?.appId||!support?.supported)return;let active=true;void loadPush(status.appId).then(value=>{if(active){sdk.current=value;setSdkReady(true);setSdkEnabled(value.User.PushSubscription.optedIn);}}).catch(()=>{if(active)setError('Notification service could not load. Check your connection and reload Bloom.');});return()=>{active=false;};},[status?.appId,support?.supported]);
 async function run(fn:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError(e instanceof ApiError&&e.code==='CONFLICT'?'Wait at least one minute after your last verification or test notification before trying again. If verification is pending, tap the newest verification notification first.':e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);lock.current=false;}}
 const state=!support||!status?'Checking settings…':permission==='denied'?'Blocked':!support?.supported?'Unsupported':status?.verified&&permission==='granted'&&sdkEnabled?'Enabled on this device':'Not enabled';
 return <section className="bloom-push-card"><div><h2>Enable job notifications</h2><p>Hear about available cleanings in your approved city and get reminders for jobs you claim.</p><p role="status">{state}{status?.pending?' · Tap the verification notification to finish.':''}</p></div><button className="bloom-button secondary" onClick={()=>setOpen(true)}>Notification settings</button>
 {open&&<Modal title="Job notification settings" className="bloom-dialog-surface bloom-push-dialog" onClose={()=>setOpen(false)}><header><h2>Job notifications</h2><p role="status">{state}</p></header>
 {support?.ios&&!support.installed?<><h3>Install Bloom on your iPhone</h3><ol><li>Open Bloom in Safari and tap Share.</li><li>Choose Add to Home Screen, then Add.</li><li>Open Bloom from its Home Screen icon, sign in, and return here to enable notifications.</li></ol><p>Requires iOS 16.4 or later.</p></>:!support?.supported?<p>This browser does not support web push. On Android, open Bloom in Chrome. On iPhone, use the installed Home Screen app.</p>:permission==='denied'?<p>Notifications are blocked. On Android, open Chrome’s site settings for Bloom and allow Notifications; also check Android Settings → Apps → Chrome → Notifications. On iPhone, open Settings → Notifications → Bloom and allow notifications. Then reopen Bloom.</p>:<><p>{support.ios?'Allow notifications when your iPhone asks.':'Allow notifications when Chrome asks. Adding Bloom to your Home Screen is optional.'} We only ask after you tap Enable.</p><p>To verify this device, we’ll send a notification asking you to tap it. No account is linked until you do.</p>
 {status?.verified?<p>This device is verified. You can send a test notification below.</p>:!status?.configured?<p>Notifications are not available for this account yet. Your admin is completing setup.</p>:<button className="bloom-button" disabled={busy||!status.appId||!sdkReady} onClick={()=>void run(async()=>{
  if(!sdk.current)return;
  await sdk.current.Notifications.requestPermission();setPermission(Notification.permission);
  if(Notification.permission!=='granted')return;
  await sdk.current.User.PushSubscription.optIn();
  for(let attempt=0;!sdk.current.User.PushSubscription.id&&attempt<25;attempt++)await new Promise(resolve=>setTimeout(resolve,200));
  setSdkEnabled(sdk.current.User.PushSubscription.optedIn);
  const id=sdk.current.User.PushSubscription.id;if(!id)throw new Error('Device registration is still starting. Wait a moment, then retry.');
  await request('/push/challenge',{body:{subscription:id}});await refresh();setMessage('Tap the Bloom verification notification on this device to finish enabling.');
 })}>{busy?'Working…':'Enable notifications'}</button>}</>}
 <fieldset disabled={busy||!status}><legend>Choose your notifications</legend><label><input type="checkbox" checked={status?.newJobs??false} onChange={e=>void run(async()=>{setStatus(await request<Settings>('/push/settings',{body:{newJobs:e.target.checked,reminders:status?.reminders??false}}));})}/>New available jobs in my approved city</label><label><input type="checkbox" checked={status?.reminders??false} onChange={e=>void run(async()=>{setStatus(await request<Settings>('/push/settings',{body:{newJobs:status?.newJobs??false,reminders:e.target.checked}}));})}/>Claimed-job reminders at 6 PM and 8 AM in the cleaning city</label></fieldset>
 <p>Allow one minute between verification and test notifications.</p>
 <button className="bloom-button secondary" disabled={busy||!status?.verified||!status.configured||permission!=='granted'||!sdkEnabled} onClick={()=>void run(async()=>{const value=await request<{message:string}>('/push/test',{body:{}});setMessage(value.message);})}>Send test notification</button>
 {status?.verified&&<button className="bloom-button secondary" disabled={busy} onClick={()=>void run(async()=>{await request('/push/device',{body:{disable:true}});await sdk.current?.User.PushSubscription.optOut();setSdkEnabled(false);await refresh();})}>Disable on this device</button>}
 <p>Signing out stops reminders on this device. After switching accounts or signing in again, verify this device again. Each device has its own setup.</p>
 {!!error&&<p role="alert">{error} <button className="bloom-button secondary" disabled={busy} onClick={()=>void run(async()=>{await refresh();})}>Retry</button></p>}{!!message&&<p role="status">{message}</p>}
 </Modal>}{!open&&!!error&&<p role="alert">{error}</p>}</section>;
}
