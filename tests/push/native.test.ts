import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createECDH,randomBytes} from 'node:crypto';
import {generateVAPIDKeys,generateRequestDetails} from 'web-push';
import {classifyNativeFailure,displayToken,nativeConfiguration,openSubscription,sealSubscription,sendNative,subscriptionIdentity,validateSubscription} from '../../src/server/push/native';

const keys=generateVAPIDKeys();process.env.NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY=keys.publicKey;process.env.BLOOM_PUSH_VAPID_PRIVATE_KEY=keys.privateKey;
process.env.BLOOM_PUSH_VAPID_SUBJECT='https://bloom.example';process.env.BLOOM_PUSH_SUBSCRIPTION_ENCRYPTION_KEY=randomBytes(32).toString('base64url');
const ecdh=createECDH('prime256v1');ecdh.generateKeys();
const fixture={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic',expirationTime:null,keys:{auth:randomBytes(16).toString('base64url'),p256dh:ecdh.getPublicKey().toString('base64url')}};
test('native subscription validation rejects arbitrary endpoints, redirects, invalid keys and expired capabilities',()=>{
 assert.deepEqual(validateSubscription(fixture),fixture);
 for(const endpoint of ['http://fcm.googleapis.com/fcm/send/test','https://127.0.0.1/push','https://fcm.googleapis.com.evil.example/fcm/send/test','https://user:pass@web.push.apple.com/push','https://fcm.googleapis.com:8443/fcm/send/test','https://evil.example/push'])assert.throws(()=>validateSubscription({...fixture,endpoint}));
 assert.throws(()=>validateSubscription({...fixture,expirationTime:Date.now()-1}));assert.throws(()=>validateSubscription({...fixture,keys:{...fixture.keys,auth:'arbitrary-id'}}));
 assert.throws(()=>validateSubscription({...fixture,keys:{...fixture.keys,p256dh:Buffer.alloc(65).toString('base64url')}}));
});
test('subscription encryption authenticates ciphertext and keeps endpoint/key material out of storage',()=>{
 const first=sealSubscription(fixture),second=sealSubscription(fixture);assert.notEqual(first,second);assert(!first.includes(fixture.endpoint));assert(!first.includes(fixture.keys.auth));assert.deepEqual(openSubscription(first),fixture);
 assert.throws(()=>openSubscription(first.slice(0,-3)+'abc'));assert.equal(subscriptionIdentity(fixture).fingerprint,subscriptionIdentity(openSubscription(second)).fingerprint);
});
test('real library builds encrypted, VAPID-signed device-only payloads; network response is mocked',async()=>{
 const delivery='00000000-0000-4000-8000-000000000001',token=displayToken(delivery,'generation');let calls=0;
 const result=await sendNative({subscription:sealSubscription(fixture),delivery,token,ttl:999999},async(subscription,payload,options)=>{
  calls++;assert.equal(subscription.endpoint,fixture.endpoint);assert.deepEqual(JSON.parse(String(payload)),{delivery,token});assert.equal(options?.TTL,86400);
  assert(typeof payload==='string');const details=generateRequestDetails(subscription,payload,options);assert(details.body instanceof Buffer);assert(!details.body.includes(Buffer.from(token)));assert(!details.body.includes(Buffer.from(delivery)));assert.match(String(details.headers.Authorization),/^vapid /);assert.equal(details.headers['Content-Encoding'],'aes128gcm');
  return {statusCode:201,body:'',headers:{}};
 });assert.equal(result.state,'accepted');assert.equal(calls,1);assert.equal(displayToken(delivery,'generation'),token);assert.notEqual(displayToken(delivery,'next-generation'),token);
});
test('native expiry, permanent rejection, rate limits, network and retryable failures are distinct',async()=>{
 for(const status of [404,410])assert.deepEqual(classifyNativeFailure(status),{state:'failed',error:'SUBSCRIPTION_EXPIRED',invalid:true});
 for(const status of [undefined,429,500,503])assert.equal(classifyNativeFailure(status).state,'pending');
 for(const status of [400,401,403,302])assert.deepEqual(classifyNativeFailure(status),{state:'failed',error:'PROVIDER_REJECTED'});
 const result=await sendNative({subscription:sealSubscription(fixture),delivery:'00000000-0000-4000-8000-000000000001',token:'a'.repeat(64),ttl:30},async()=>{throw Object.assign(Error('private upstream detail'),{statusCode:410});});assert.equal(result.invalid,true);
});
test('missing encryption configuration cannot produce predictable display secrets',()=>{
 const value=process.env.BLOOM_PUSH_SUBSCRIPTION_ENCRYPTION_KEY;delete process.env.BLOOM_PUSH_SUBSCRIPTION_ENCRYPTION_KEY;
 try{assert.throws(()=>displayToken('id','generation'));assert.throws(()=>nativeConfiguration());}finally{process.env.BLOOM_PUSH_SUBSCRIPTION_ENCRYPTION_KEY=value;}
});
