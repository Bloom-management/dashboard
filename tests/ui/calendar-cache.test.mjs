import test from 'node:test';
import assert from 'node:assert/strict';
import { CalendarCache } from '../../src/components/bloom/calendar-cache.ts';
test('month round trips reuse data and unchanged checks never notify',async()=>{
 let requests=0,notifications=0;
 const cache=new CalendarCache(async(key,etag)=>{requests++;return etag?{unchanged:true}:{data:[key],etag:'v1'};});
 cache.subscribe(()=>notifications++);
 await cache.load('September');await cache.load('October');await cache.load('September');
 assert.equal(requests,2);assert.deepEqual(cache.entry('September').data,['September']);
 await cache.load('September',true);assert.equal(requests,3);assert.equal(notifications,2);
});
test('additions, updates and removals replace cached data; failures are not empty calendars',async()=>{
 let data=['first'],etag='1';
 const cache=new CalendarCache(async()=>({data:[...data],etag}));
 await cache.load('month');data.push('second');etag='2';await cache.load('month',true);assert.deepEqual(cache.entry('month').data,['first','second']);
 data=['changed'];etag='3';await cache.load('month',true);assert.deepEqual(cache.entry('month').data,['changed']);
 data=[];etag='4';await cache.load('month',true);assert.deepEqual(cache.entry('month').data,[]);
 const failed=new CalendarCache(async()=>{throw new Error('Offline');});await failed.load('month');assert.equal(failed.entry('month').data,undefined);assert.ok(failed.entry('month').error);
});
test('identity scopes do not share records and duplicate requests are coalesced',async()=>{
 let release;let calls=0;
 const cache=new CalendarCache(()=>{calls++;return new Promise(resolve=>{release=resolve;});});
 const first=cache.load('month');await cache.load('month');assert.equal(calls,1);release({data:['private'],etag:'1'});await first;
 const other=new CalendarCache(async()=>({data:[]}));assert.equal(other.entry('month').data,undefined);
});
test('authorization loss clears every cached month',async()=>{
 let revoked=false;
 const cache=new CalendarCache(async()=>{if(revoked)throw Object.assign(new Error('Sign in'),{code:'UNAUTHENTICATED'});return {data:['private'],etag:'1'};});
 await cache.load('September');await cache.load('October');revoked=true;await cache.load('September',true);
 assert.equal(cache.entry('October').data,undefined);assert.equal(cache.entry('October').error.code,'UNAUTHENTICATED');
});

test('a prefetched month is ready on navigation without another request or loading state', async () => {
 const requests=[];
 const cache=new CalendarCache(async key=>{requests.push(key);return {data:[key]};});
 await Promise.all(['August','September','October'].map(key=>cache.load(key)));
 assert.equal(cache.entry('October').loading,false);
 await cache.load('October');
 assert.deepEqual(requests,['August','September','October']);
 assert.deepEqual(cache.entry('October').data,['October']);
});
