import 'server-only';
import { createHash,randomBytes,timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { auth } from '@clerk/nextjs/server';
import { currentUser } from '../auth/session';
import { BackendError } from '../db/errors';
import { CalendarError } from '../calendar/errors';
import { serviceRpc } from '../calendar/store';
import { sendPush } from './provider';
import {displayToken,nativeReady,sendNative} from './native';
export const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const transport=serviceRpc();
export async function pushRpc<T>(name:string,args:Record<string,unknown>):Promise<T>{try{return await transport<T>(name,args);}catch(e){if(e instanceof CalendarError&&['FORBIDDEN','CONFLICT','VALIDATION_ERROR'].includes(e.code))throw new BackendError(e.code as 'FORBIDDEN'|'CONFLICT'|'VALIDATION_ERROR');throw e;}}
export function pushMode(){return process.env.BLOOM_PUSH_MODE==='live'&&process.env.NODE_ENV==='production'?'live':process.env.BLOOM_PUSH_MODE==='test'?'test':'off';}
export function permitted(subject:string){return pushMode()==='live'||(pushMode()==='test'&&(process.env.BLOOM_PUSH_TEST_SUBJECTS??'').split(',').map(x=>x.trim()).includes(subject));}
/** Test accounts may enroll from any device; the account subject remains allowlisted. */
export function permittedDevice(subject:string,_device:string){return permitted(subject);}
export function nativeEnabled(){return process.env.BLOOM_PUSH_TRANSPORT==='native';}
/** Optional rollout allowlist affects enrollment only; existing transport delivery remains live. */
export function nativeEnrollmentEnabled(subject:string){
 if(!nativeEnabled())return false;
 const subjects=(process.env.BLOOM_PUSH_NATIVE_SUBJECTS??'').split(',').map(value=>value.trim()).filter(Boolean);
 return subjects.length===0||subjects.includes(subject);
}
export function appUrl(path:string){const base=process.env.NEXT_PUBLIC_APP_URL;if(!base)throw new BackendError('CONFIGURATION_ERROR');return new URL(path,base).href;}
export async function deviceId(create=false){
 const jar=await cookies();let value=jar.get('bloom_push_device')?.value;
 if(!value||! /^[\da-f]{64}$/.test(value)){
  if(!create)return null;value=randomBytes(32).toString('hex');
  jar.set('bloom_push_device',value,{httpOnly:true,secure:process.env.NODE_ENV==='production'||process.env.NEXT_PUBLIC_APP_URL?.startsWith('https://')===true,sameSite:'strict',path:'/',maxAge:365*86400});
 }
 return hash(value);
}
export async function pushActor(){const identity=await auth();const user=await currentUser();if(!['cleaner','owner','admin'].includes(user.role)||!identity.sessionId||!identity.userId)throw new BackendError('FORBIDDEN');return {user,session:identity.sessionId,subject:identity.userId};}
export async function deviceAction(action:string,input:Record<string,unknown>={}):Promise<Record<string,unknown>>{
 const actor=await pushActor();
 if(input.accountId!==undefined&&input.accountId!==actor.user.id)throw new BackendError('FORBIDDEN');
 const device=await deviceId(true);
 const status=await pushRpc<Record<string,unknown>>('bloom_push_device',{p_device:device,p_user:actor.user.id,p_session:actor.session,p_action:action,p_input:input});
 const health=await pushRpc<{activated:boolean;lastTickAt:string|null}>('bloom_push_health',{});
 const enrollmentNative=nativeEnrollmentEnabled(actor.subject);
 const configured=!!device&&permittedDevice(actor.subject,device)&&(enrollmentNative?nativeReady():!!process.env.ONESIGNAL_APP_ID&&!!process.env.ONESIGNAL_REST_API_KEY);
 return {...status,accountId:actor.user.id,accountName:actor.user.displayName,opportunities:actor.user.role==='cleaner'&&actor.user.bloomNetworkEnabled===true,backgroundReady:health.activated&&!!health.lastTickAt&&Date.now()-Date.parse(health.lastTickAt)<5*60000,role:actor.user.role,settingsUrl:`/${actor.user.role}?notifications=1`,configured,nativeEnabled:enrollmentNative,vapidPublicKey:configured&&enrollmentNative?process.env.NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY:null};
}
export type Delivery={deviceId:string;transport:'onesignal'|'native';generation:string;nativeSubscription:string;subscription:string;session:string;subject:string;userId:string;expiresAt:string;kind:string;content:{body:string;url:string;count?:number}};
export async function dispatch(only?:string){
 if(pushMode()==='off')return {disabled:true};
 const rows=await pushRpc<{id:string;lease:string;attempts:number}[]>('bloom_push_take',{p_limit:5,p_only:only??null});
 const outcomes=await Promise.all(rows.map(async row=>{
  const finish=(state:string,error:string|null=null,provider:string|null=null,invalid=false)=>pushRpc('bloom_push_finish',{p_id:row.id,p_lease:row.lease,p_state:state,p_error:error,p_provider:provider,p_invalid:invalid});
  try{
   const d=await pushRpc<Delivery|null>('bloom_push_delivery',{p_id:row.id,p_lease:row.lease});
   if(!d)return void await finish('skipped','INELIGIBLE');
   if(!permittedDevice(d.subject,d.deviceId))return void await finish('skipped','TEST_ONLY');
   // Stable across retries, never returned by enrollment or identifier lookups.
   const token=d.transport==='native'?displayToken(row.id,d.generation):null;
   if(token&&!await pushRpc<boolean>('bloom_push_display_token',{p_id:row.id,p_lease:row.lease,p_hash:hash(token)}))return void await finish('skipped','INELIGIBLE');
   const fresh=await pushRpc<Delivery|null>('bloom_push_delivery',{p_id:row.id,p_lease:row.lease});
   if(!fresh)return void await finish('skipped','INELIGIBLE');
   const ttl=Math.floor((Date.parse(fresh.expiresAt)-Date.now())/1000);
   const sent=fresh.transport==='native'&&token?await sendNative({subscription:fresh.nativeSubscription,delivery:row.id,token,ttl}):await sendPush({subscription:fresh.subscription,key:row.id,delivery:row.id,url:appUrl(`/notifications/open?delivery=${row.id}`),ttl});
   await finish(sent.state,sent.error??null,sent.providerId??null,sent.invalid);return sent.state;
  }catch{await finish('pending','TRANSIENT');return 'pending';}
 }));return {attempted:rows.length,outcomes};
}
export function checkSchedule(request:Request){const secret=process.env.BLOOM_PUSH_SCHEDULER_SECRET;if(!secret||secret.length<32)throw new BackendError('CONFIGURATION_ERROR');const a=Buffer.from(request.headers.get('authorization')??''),b=Buffer.from(`Bearer ${secret}`);if(a.length!==b.length||!timingSafeEqual(a,b))throw new BackendError('UNAUTHENTICATED');}
