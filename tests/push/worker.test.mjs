import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const code=readFileSync('public/push/OneSignalSDKWorker.js','utf8');
function worker(fetch){const listeners={},shown=[],opened=[];const self={skipWaiting:async()=>opened.push('activated'),addEventListener:(name,fn)=>listeners[name]=fn,registration:{showNotification:async(title,options)=>shown.push({title,...options})},clients:{openWindow:async url=>opened.push(url)}};vm.runInNewContext(code,{self,fetch,AbortSignal,importScripts:()=>{}});return {listeners,shown,opened};}
test('verified device renders current counts and exact upcoming destination',async()=>{const w=worker(async()=>Response.json({data:{body:'You have 2 cleanings today. Tap to view your schedule.',url:'/cleaner?view=upcoming&date=2026-11-01'}}));let done;w.listeners.push({data:{json:()=>({custom:{a:{bloom_delivery:'test'}}})},stopImmediatePropagation(){},waitUntil:p=>done=p});await done;assert.equal(w.shown[0].title,'Bloom');assert.match(w.shown[0].body,/2 cleanings/);assert.match(w.shown[0].data.url,/2026-11-01/);});
test('revoked/offline devices use the generic fallback',async()=>{for(const fn of [async()=>new Response('',{status:403}),async()=>{throw Error();}]){const w=worker(fn);let done;w.listeners.push({data:{json:()=>({custom:{a:{bloom_delivery:'test'}}})},stopImmediatePropagation(){},waitUntil:p=>done=p});await done;assert.equal(w.shown[0].body,'Open Bloom to check your notifications.');}});
test('non-Bloom push remains handled by OneSignal',()=>{const w=worker(()=>{throw Error();});w.listeners.push({data:{json:()=>({custom:{}})},stopImmediatePropagation(){throw Error('must not intercept');},waitUntil(){throw Error();}});assert.equal(w.shown.length,0);});

test('background completion opens authorized owner/admin Activity and rejects unsafe destinations',async()=>{
 for(const role of ['owner','admin']){const url=`/${role}?view=activity&job=00000000-0000-4000-8000-000000000001`;const w=worker(async()=>Response.json({data:{body:'Cleaning completed.',url}}));let done;w.listeners.push({data:{json:()=>({custom:{a:{bloom_delivery:'test'}}})},stopImmediatePropagation(){},waitUntil:p=>done=p});await done;assert.equal(w.shown[0].data.url,url);w.listeners.notificationclick({notification:{data:w.shown[0].data,close(){}},stopImmediatePropagation(){},waitUntil:p=>done=p});await done;assert.equal(w.opened[0],url);}
 for(const url of ['//evil.example','/admin-evil','https://evil.example','/owner\\\\evil']){const w=worker(async()=>Response.json({data:{body:'Private content',url}}));let done;w.listeners.push({data:{json:()=>({custom:{a:{bloom_delivery:'test'}}})},stopImmediatePropagation(){},waitUntil:p=>done=p});await done;assert.equal(w.shown[0].data.url,'/');assert.notEqual(w.shown[0].body,'Private content');}
});

test('persistent device shows role-labelled alerts and opens the account-check destination',async()=>{
 const url='/notifications/open?delivery=00000000-0000-4000-8000-000000000001';
 for(const role of ['Admin','Owner','Cleaner']){
  const w=worker(async()=>Response.json({data:{body:`[${role}] Cleaning completed at Trumbull.`,url}}));let done;
  w.listeners.push({data:{json:()=>({custom:{a:{bloom_delivery:'delivery'}}})},stopImmediatePropagation(){},waitUntil:p=>done=p});await done;
  assert.equal(w.shown[0].body,`[${role}] Cleaning completed at Trumbull.`);
  w.listeners.notificationclick({notification:{data:w.shown[0].data,close(){}},stopImmediatePropagation(){},waitUntil:p=>done=p});await done;
  assert.equal(w.opened[0],url);
 }
});

 test('offline detail lookup preserves the authenticated notification destination',async()=>{
 const delivery='00000000-0000-4000-8000-000000000001';
 const w=worker(async()=>{throw Error('offline');});let done;
 w.listeners.push({data:{json:()=>({custom:{a:{bloom_delivery:delivery}}})},stopImmediatePropagation(){},waitUntil:p=>done=p});await done;
 assert.equal(w.shown[0].body,'Open Bloom to check your notifications.');
 w.listeners.notificationclick({notification:{data:w.shown[0].data,close(){}},stopImmediatePropagation(){},waitUntil:p=>done=p});await done;
 assert.equal(w.opened[0],`/notifications/open?delivery=${delivery}`);
 });

test('push worker activates updates without waiting for app windows',async()=>{const w=worker(()=>{});let done;w.listeners.install({waitUntil:p=>done=p});await done;assert.deepEqual(w.opened,['activated']);});
