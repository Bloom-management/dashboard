import {test} from 'node:test';import assert from 'node:assert/strict';
import {sendPush} from '../../src/server/push/provider';
import {cleanerDestination,notificationDate} from '../../src/contracts/push-navigation';
const input={subscription:'00000000-0000-4000-8000-000000000001',key:'00000000-0000-4000-8000-000000000002',url:'https://bloom.example/cleaner',ttl:1000,delivery:'00000000-0000-4000-8000-000000000003'};
process.env.ONESIGNAL_APP_ID='synthetic-app';process.env.ONESIGNAL_REST_API_KEY='synthetic-key';
test('device-only targeting, stable provider key, short TTL and no schedule details in provider payload',async()=>{
 const result=await sendPush(input,async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.deepEqual(body.include_subscription_ids,[input.subscription]);assert.equal(body.idempotency_key,input.key);assert.equal(body.ttl,60);assert.equal(body.headings.en,'Bloom Cleaning');assert.equal(body.data.bloom_delivery,input.delivery);assert.equal(body.include_aliases,undefined);assert.equal(body.included_segments,undefined);assert.equal(body.contents.en,'Open Bloom to check your job notifications.');return Response.json({id:input.key});});assert.equal(result.state,'accepted');
});
test('rate limit/server/network bounded retry classification and dead subscriptions',async()=>{
 for(const status of [429,500,503])assert.equal((await sendPush(input,async()=>new Response('',{status}))).state,'pending');
 assert.equal((await sendPush(input,async()=>{throw Error('private provider details');})).error,'TRANSIENT');
 assert.equal((await sendPush(input,async()=>new Response('',{status:401}))).state,'failed');
 assert.equal((await sendPush(input,async()=>Response.json({id:'',errors:['All included players are not subscribed']}))).invalid,true);
});
test('click destinations accept local views/dates only, without authority',()=>{
 assert.equal(cleanerDestination({view:'upcoming',date:'2026-11-01',redirect:'https://evil.example',role:'admin'}),'/cleaner?view=upcoming&date=2026-11-01');
 assert.equal(notificationDate('2026-02-30'),null);assert.equal(cleanerDestination({view:'//evil',date:'bad'}),'/cleaner');
});
