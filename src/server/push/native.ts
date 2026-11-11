import {createCipheriv,createDecipheriv,createECDH,createHash,createHmac,ECDH,randomBytes} from 'node:crypto';
import * as webpush from 'web-push';
import type {SendResult} from './provider';

export type NativeSubscription={endpoint:string;expirationTime?:number|null;keys:{auth:string;p256dh:string}};
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function bytes(value:unknown,length:number){
 if(typeof value!=='string'||!/^[A-Za-z0-9_-]+={0,2}$/.test(value))throw Error('INVALID_SUBSCRIPTION');
 const result=Buffer.from(value,'base64url');
 if(result.length!==length||result.toString('base64url')!==value.replace(/=+$/,''))throw Error('INVALID_SUBSCRIPTION');
 return result;
}
/** Only vendor-operated push HTTPS origins; no arbitrary outbound URLs or redirects. */
export function validateSubscription(value:unknown):NativeSubscription{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_SUBSCRIPTION');
 const s=value as Record<string,unknown>;
 if(Object.keys(s).some(k=>!['endpoint','expirationTime','keys'].includes(k))||typeof s.endpoint!=='string'||s.endpoint.length>2048)throw Error('INVALID_SUBSCRIPTION');
 const url=new URL(s.endpoint);
 const allowed=(url.hostname==='fcm.googleapis.com'&&/^\/(?:fcm\/send|wp)\/.+/.test(url.pathname))
  ||(url.hostname==='updates.push.services.mozilla.com'&&url.pathname.startsWith('/wpush/v2/'))
  ||(url.hostname==='web.push.apple.com'&&url.pathname.length>1)
  ||(/^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname)&&url.pathname.length>1);
 if(!allowed||url.protocol!=='https:'||url.port||url.username||url.password||url.hash)throw Error('INVALID_SUBSCRIPTION');
 if(!s.keys||typeof s.keys!=='object'||Array.isArray(s.keys)||Object.keys(s.keys).some(k=>!['auth','p256dh'].includes(k)))throw Error('INVALID_SUBSCRIPTION');
 const keys=s.keys as Record<string,unknown>;const auth=bytes(keys.auth,16),p256dh=bytes(keys.p256dh,65);
 ECDH.convertKey(p256dh,'prime256v1',undefined,undefined,'uncompressed');
 if(s.expirationTime!==undefined&&s.expirationTime!==null&&(typeof s.expirationTime!=='number'||!Number.isFinite(s.expirationTime)||s.expirationTime<=Date.now()))throw Error('INVALID_SUBSCRIPTION');
 return {endpoint:url.href,expirationTime:s.expirationTime as number|null|undefined,keys:{auth:auth.toString('base64url'),p256dh:p256dh.toString('base64url')}};
}
function encryptionKey(){return bytes(process.env.BLOOM_PUSH_SUBSCRIPTION_ENCRYPTION_KEY,32);}
export function displayToken(delivery:string,generation:string){return createHmac('sha256',encryptionKey()).update(`bloom-display:v1:${delivery}:${generation}`).digest('hex');}
export function nativeConfiguration(){
 const publicKey=process.env.NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY,privateKey=process.env.BLOOM_PUSH_VAPID_PRIVATE_KEY,subject=process.env.BLOOM_PUSH_VAPID_SUBJECT;
 if(!publicKey||!privateKey||!subject||(!subject.startsWith('mailto:')&&!subject.startsWith('https://')))throw Error('NATIVE_CONFIGURATION');
 const ecdh=createECDH('prime256v1');ecdh.setPrivateKey(bytes(privateKey,32));
 if(!ecdh.getPublicKey().equals(bytes(publicKey,65)))throw Error('NATIVE_CONFIGURATION');
 encryptionKey();return {publicKey,privateKey,subject};
}
export function nativeReady(){try{nativeConfiguration();return true;}catch{return false;}}
export function sealSubscription(subscription:NativeSubscription){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);cipher.setAAD(Buffer.from('bloom-native-subscription:v1'));
 const ciphertext=Buffer.concat([cipher.update(JSON.stringify(subscription),'utf8'),cipher.final()]);
 return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),ciphertext.toString('base64url')].join('.');
}
export function openSubscription(value:string){
 const parts=value.split('.');if(parts.length!==4||parts[0]!=='v1')throw Error('NATIVE_CONFIGURATION');
 const decipher=createDecipheriv('aes-256-gcm',encryptionKey(),bytes(parts[1],12));decipher.setAAD(Buffer.from('bloom-native-subscription:v1'));decipher.setAuthTag(bytes(parts[2],16));
 return validateSubscription(JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[3],'base64url')),decipher.final()]).toString('utf8')));
}
export function subscriptionIdentity(s:NativeSubscription){return {endpointHash:digest(s.endpoint),fingerprint:digest(JSON.stringify([s.endpoint,s.keys.auth,s.keys.p256dh]))};}
export type NativeSend=typeof webpush.sendNotification;
export async function sendNative(input:{subscription:string;delivery:string;token:string;ttl:number},send:NativeSend=webpush.sendNotification):Promise<SendResult>{
 const subscription=openSubscription(input.subscription),vapidDetails=nativeConfiguration();
 try{
  const result=await send(subscription,JSON.stringify({delivery:input.delivery,token:input.token}),{
   vapidDetails,TTL:Math.max(0,Math.min(86400,input.ttl)),timeout:8000,urgency:'normal',
   topic:Buffer.from(input.delivery.replaceAll('-',''),'hex').toString('base64url'),
  });
  if(result.statusCode===201||result.statusCode===202)return {state:'accepted'};
  return classifyNativeFailure(result.statusCode);
 }catch(error){return classifyNativeFailure((error as {statusCode?:number}).statusCode);}
}
export function classifyNativeFailure(status?:number):SendResult{
 if(status===404||status===410)return {state:'failed',error:'SUBSCRIPTION_EXPIRED',invalid:true};
 if(status===undefined||status===429||status>=500)return {state:'pending',error:'TRANSIENT'};
 return {state:'failed',error:'PROVIDER_REJECTED'};
}
