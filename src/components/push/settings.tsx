'use client';
import {useAuth} from '@clerk/nextjs';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ApiError,request} from '../bloom/api';
import {Modal} from '../bloom/primitives';
import {ButtonContent} from '../bloom/button-content';
import {deviceSupport} from './sdk';
import {prepareNativeWorker,requestNativePermission,nativeSubscription} from './native-sdk';
type Settings={unclaimed:boolean;assignments:boolean;teammates:boolean;changes:boolean;payments:boolean;coverage:boolean;calendar:boolean;requests:boolean;payouts:boolean;invitations:boolean;transport:'native'|'onesignal';nativeEnabled:boolean;vapidPublicKey:string|null;accountId:string;accountName:string;pushEnabled:boolean;opportunities:boolean;lowSupplies:boolean;maintenance:boolean;starts:boolean;role:string;completions:boolean;verified:boolean;linked:boolean;newJobs:boolean;reminders:boolean;configured:boolean};
type Action='settings'|'device'|'disconnect'|'test';
type DeviceSetup={permission:NotificationPermission;subscription?:PushSubscriptionJSON};
export function PushSettings({hideCard=false,onDiagnostics}:{hideCard?:boolean;onDiagnostics?:()=>void}){
 const {userId,sessionId}=useAuth();
 const identity=useRef({userId,sessionId});if(identity.current.userId!==userId||identity.current.sessionId!==sessionId)identity.current={userId,sessionId};
 const [open,setOpen]=useState(false),[status,setStatus]=useState<Settings>(),[busy,setBusy]=useState(false);
 const [errors,setErrors]=useState<Partial<Record<Action,string>>>({}),[message,setMessage]=useState(''),[retryAt,setRetryAt]=useState(0),[now,setNow]=useState(0);
 const [support,setSupport]=useState<ReturnType<typeof deviceSupport>>(),[permission,setPermission]=useState<NotificationPermission>('default');
 const [localSubscription,setLocalSubscription]=useState<boolean>();
 const lock=useRef(false),active=useRef(true),sequence=useRef(0);
 const refresh=useCallback(async()=>{const ticket=++sequence.current;const started=identity.current;const value=await request<Settings>('/push/settings');if(active.current&&identity.current===started&&ticket===sequence.current){setStatus(value);if(value.verified&&value.linked)setErrors(e=>({...e,device:undefined}));setPermission('Notification' in window?Notification.permission:'default');}return value;},[userId,sessionId]);
 useEffect(()=>{active.current=true;setStatus(undefined);setErrors({});setMessage('');setSupport(deviceSupport());setOpen(new URLSearchParams(location.search).get('notifications')==='1');void refresh().catch(()=>setErrors({settings:'Couldn’t load notification settings. Try again.'}));const focus=()=>void refresh().catch(()=>{});const show=()=>setOpen(true);window.addEventListener('focus',focus);window.addEventListener('bloom:notification-settings',show);return()=>{active.current=false;sequence.current++;window.removeEventListener('focus',focus);window.removeEventListener('bloom:notification-settings',show);};},[refresh]);
 useEffect(()=>{if(status?.nativeEnabled&&support?.supported)void prepareNativeWorker().catch(()=>{});},[status?.nativeEnabled,support?.supported]);
 useEffect(()=>{
  if(status?.transport!=='native'||!support?.supported)return;
  let current=true;
  void navigator.serviceWorker.getRegistration('/bloom-push/').then(r=>r?.pushManager.getSubscription()).then(value=>{if(current)setLocalSubscription(!!value);}).catch(()=>{});
  return()=>{current=false;};
 },[status,support?.supported]);
 useEffect(()=>{if(!retryAt)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[retryAt]);
 async function run(action:Action,fn:()=>Promise<void>){if(lock.current)return false;const started=identity.current;lock.current=true;setBusy(true);setErrors(e=>({...e,[action]:undefined}));if(action!=='settings')setMessage('');try{await fn();return true;}catch(e){if(!active.current||identity.current!==started)return false;const limited=(action==='test'||action==='device')&&e instanceof ApiError&&e.code==='CONFLICT';if(limited){setRetryAt(Date.now()+(action==='test'?60000:5000));setNow(Date.now());}setErrors(old=>({...old,[action]:limited?'Please wait a moment before trying again.':action==='device'?'Couldn’t enable notifications on this device. Try again.':action==='disconnect'?'Couldn’t disconnect this account. Try again.':action==='test'?'Couldn’t send a test notification. Try again.':'Couldn’t save notification settings. Try again.'}));return false;}finally{lock.current=false;if(active.current)setBusy(false);}}
 async function save(patch:Partial<Settings>){if(!status)return;const id=status.accountId;const started=identity.current;const value=await request<Settings>('/push/settings',{body:{accountId:id,...patch}});if(active.current&&identity.current===started&&value.accountId===id){setStatus(value);if(patch.pushEnabled===false){setErrors({});setMessage('');}}}
 function beginDeviceSetup():Promise<DeviceSetup>{
  // Start the permission/subscription chain in the gesture, independently of saving preferences.
  const setup=requestNativePermission().then(async permission=>({permission,subscription:permission==='granted'&&status?.nativeEnabled&&status.configured&&status.vapidPublicKey?await nativeSubscription(status.vapidPublicKey):undefined}));
  void setup.catch(()=>{});return setup;
 }
 async function register(setupResult?:Promise<DeviceSetup>){
  if(!status||!support?.supported||(support.ios&&!support.installed))return;
  const accountId=status.accountId;const started=identity.current;
  // Called directly in the gesture, before preference/network awaits (required by Safari).
  const setup=await (setupResult??beginDeviceSetup());const allowed=setup.permission;if(identity.current!==started)return;if(active.current)setPermission(allowed);
  if(allowed!=='granted')return;
  if(!status.nativeEnabled){if(!status.verified||status.transport==='native')throw Error('Unavailable');await request('/push/device',{body:{link:true,accountId}});}
  else{
   if(!status.configured||!status.vapidPublicKey)throw Error('Unavailable');
   const subscription=setup.subscription;if(!subscription)throw Error('Unavailable');if(identity.current!==started)return;
   const context={accountId,sessionId:started.sessionId};
   const enrollment=await request<{nonce:string}>('/push/enroll',{body:{...context,action:'start'}});if(identity.current!==started)return;
   await request('/push/enroll',{body:{...context,action:'complete',nonce:enrollment.nonce,subscription}});
  }
  const value=await refresh();if(active.current&&identity.current===started&&value.accountId===accountId)setMessage('Device enabled.');
 }
 const registered=!!status?.verified&&!!status.linked&&permission==='granted'&&(status.transport!=='native'||localSubscription!==false);
 const deviceState=permission==='denied'?'Blocked in browser settings':support?.ios&&!support.installed?'Home Screen installation required':support&&!support.supported?'This browser does not support push notifications':permission==='default'?'Permission required':registered?'Connected to this account':'Not connected to this account';
 const waiting=retryAt>now;
 const categories: [keyof Settings,string][]=[];
 if(status?.role==='cleaner'){if(status.opportunities)categories.push(['newJobs','New available jobs'],['unclaimed','Unclaimed jobs']);categories.push(['assignments','Job assignments'],['teammates','Teammate updates'],['changes','Job changes'],['reminders','Upcoming cleanings'],['payments','Payment updates']);}
 else if(status){categories.push(['assignments','Claims and staffing'],['coverage','Unassigned cleanings'],['starts','Cleaning started'],['calendar','Booking and calendar changes'],['payouts','Payout reminders']);if(status.role==='owner')categories.push(['invitations','Cleaner invitations']);if(status.role==='admin')categories.push(['requests','Actionable requests']);}
 categories.push(['completions','Completed cleanings']);
 if(status&&status.role!=='cleaner')categories.push(['lowSupplies','Low supplies'],['maintenance','Maintenance issues']);
 const help=<>{support?.ios&&!support.installed?<p>Add Bloom to your Home Screen in Safari using Share → Add to Home Screen, then open Bloom from its icon to enable this device.</p>:permission==='denied'?<p>Allow notifications for Bloom in your browser’s site settings, then return here. On iPhone, check Settings → Notifications → Bloom.</p>:support&&!support.supported?<p>This browser does not support push notifications. Use a supported browser or Bloom’s Home Screen app on iPhone.</p>:null}</>;
 return <>{!hideCard&&status?.pushEnabled===false&&<section className="bloom-push-card"><div><h2>Notifications</h2><p>Manage push notifications for your account.</p></div><button className="bloom-button secondary" onClick={()=>setOpen(true)}><ButtonContent>Notification settings</ButtonContent></button></section>}
 {open&&<Modal title="Notifications" onClose={()=>{setOpen(false);setMessage('');}}><div className="bloom-push-dialog">
 {status&&<p style={{fontSize:13,color:'var(--muted)'}}>{status.accountName}</p>}
 <fieldset disabled={busy||!status}><label><input type="checkbox" role="switch" checked={status?.pushEnabled??false} onChange={e=>{const checked=e.target.checked;const started=identity.current;const setup=checked&&!registered&&status?.configured&&support?.supported&&!(support.ios&&!support.installed)?beginDeviceSetup():undefined;void (async()=>{const saved=await run('settings',()=>save({pushEnabled:checked}));if(saved&&checked&&!registered&&identity.current===started)await run('device',()=>register(setup));})();}}/>Enable push notifications</label></fieldset>
 {errors.settings&&<p role="alert">{errors.settings}</p>}
 <hr className="bloom-push-divider"/>
 <fieldset aria-label="Notification categories" disabled={busy||!status?.pushEnabled}>{categories.map(([key,label])=><label key={key}><input type="checkbox" role="switch" checked={!!status?.pushEnabled&&!!status[key]} onChange={e=>{const checked=e.target.checked;void run('settings',()=>save({[key]:checked}));}}/>{label}</label>)}</fieldset>

 <details className="bloom-push-device"><summary>Device settings</summary><p role="status">{deviceState}</p>
 {help}
 {status?.pushEnabled&&(!registered||(status.nativeEnabled&&status.transport==='onesignal'))&&!errors.device&&<button className="bloom-button secondary" disabled={busy||waiting||permission==='denied'||!status.configured||!support?.supported||(support.ios&&!support.installed)} onClick={()=>void run('device',register)}><ButtonContent>{registered?'Update this device':'Enable on this device'}</ButtonContent></button>}
 {status?.linked&&<button className="bloom-button secondary" disabled={busy} onClick={()=>void run('disconnect',async()=>{await request('/push/device',{body:{unlink:true,accountId:status?.accountId}});await refresh();})}><ButtonContent>Disconnect this account from this device</ButtonContent></button>}
 {errors.disconnect&&<p role="alert">{errors.disconnect}</p>}
 {errors.device&&<><p role="alert">{errors.device}</p><button className="bloom-button secondary" disabled={busy||waiting||!status?.pushEnabled||permission==='denied'||!support?.supported||(support.ios&&!support.installed)} onClick={()=>void run('device',register)}><ButtonContent>Retry device setup</ButtonContent></button></>}
 <button className="bloom-button secondary" disabled={busy||waiting||!registered||!status?.pushEnabled||!status.configured||permission!=='granted'} onClick={()=>void run('test',async()=>{try{await request('/push/test',{body:{accountId:status?.accountId}});}finally{await refresh();}setMessage('Test requested.');})}><ButtonContent>Send test notification</ButtonContent></button>
 {errors.test&&<p role="alert">{errors.test}</p>}
 </details>{message&&<p role="status">{message}</p>}
 {onDiagnostics&&<button className="bloom-button secondary" onClick={()=>{setOpen(false);onDiagnostics();}}><ButtonContent>Delivery diagnostics</ButtonContent></button>}
 </div></Modal>}</>;
}
