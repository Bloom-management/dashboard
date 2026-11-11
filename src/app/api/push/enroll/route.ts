import {randomBytes} from 'node:crypto';
import {response,mutation} from '../../../../server/db/http';
import {BackendError} from '../../../../server/db/errors';
import {deviceId,hash,nativeEnrollmentEnabled,permittedDevice,pushActor,pushRpc,deviceAction} from '../../../../server/push/runtime';
import {nativeConfiguration,validateSubscription,sealSubscription,subscriptionIdentity} from '../../../../server/push/native';
export const runtime='nodejs';
export async function POST(request:Request){return response(async()=>{
 const {body}=await mutation(request,['action','accountId','sessionId','nonce','subscription']);
 const actor=await pushActor(),device=await deviceId(true);
 // A delayed browser request cannot attach the newly active account/session.
 if(body.accountId!==actor.user.id||body.sessionId!==actor.session||!device||!permittedDevice(actor.subject,device))throw new BackendError('FORBIDDEN');
 if(!nativeEnrollmentEnabled(actor.subject))throw new BackendError('CONFIGURATION_ERROR');nativeConfiguration();
 const args={p_device:device,p_user:actor.user.id,p_session:actor.session};
 if(body.action==='start'){
  const nonce=randomBytes(32).toString('hex');
  await pushRpc('bloom_push_enrollment',{...args,p_action:'start',p_hash:hash(nonce)});
  return {nonce,accountId:actor.user.id};
 }
 if(body.action!=='complete'||typeof body.nonce!=='string'||!/^[a-f0-9]{64}$/.test(body.nonce))throw new BackendError('VALIDATION_ERROR');
 let subscription;try{subscription=validateSubscription(body.subscription);}catch{throw new BackendError('VALIDATION_ERROR');}
 const identity=subscriptionIdentity(subscription);
 await pushRpc('bloom_push_enrollment',{...args,p_action:'complete',p_hash:hash(body.nonce),p_endpoint_hash:identity.endpointHash,p_fingerprint:identity.fingerprint,p_subscription:sealSubscription(subscription)});
 return deviceAction('status',{accountId:actor.user.id});
});}
