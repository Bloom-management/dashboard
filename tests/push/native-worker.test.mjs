import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code=readFileSync('public/bloom-push/worker.js','utf8');
// Mock worker/IndexedDB APIs only. These tests are not browser or physical receipt evidence.
function database(){const rows=new Map();return {open(){const request={};queueMicrotask(()=>{request.result={close(){},transaction(){
 const tx={};tx.objectStore=()=>({get(id){const read={};queueMicrotask(()=>{read.result=rows.get(id);read.onsuccess();queueMicrotask(()=>tx.oncomplete());});return read;},put(row){rows.set(row.id,row);}});return tx;
 }};request.onsuccess();});return request;}};}
function worker(fetch,indexedDB=database()){
 const listeners={},shown=[],opened=[];const self={addEventListener:(name,fn)=>listeners[name]=fn,skipWaiting:async()=>{},registration:{showNotification:async(title,options)=>shown.push({title,...options})},clients:{openWindow:async url=>opened.push(url)}};
 vm.runInNewContext(code,{self,fetch,indexedDB,queueMicrotask,Date,AbortSignal});return {listeners,shown,opened};
}
const id='00000000-0000-4000-8000-000000000001',token='a'.repeat(64);
async function push(worker,payload={delivery:id,token}){let done;worker.listeners.push({data:{json:()=>payload},waitUntil:p=>done=p});await done;}
test('native worker supplies received secret and opens only authorized-account resolver',async()=>{
 const w=worker(async(path,options)=>{assert.equal(path,'/api/push/display');assert.equal(options.credentials,'include');assert.deepEqual(JSON.parse(options.body),{delivery:id,token});return Response.json({data:{body:'Current authorized content',url:'https://evil.example'}});});
 await push(w);assert.equal(w.shown[0].body,'Current authorized content');let done;
 w.listeners.notificationclick({notification:{data:w.shown[0].data,close(){}},waitUntil:p=>done=p});await done;assert.equal(w.opened[0],'/notifications/open?delivery='+id);
});
test('persistent receipt ledger suppresses retry after worker restart',async()=>{
 const db=database(),first=worker(async()=>Response.json({data:{body:'Current'}}),db);await push(first);assert.equal(first.shown.length,1);
 const next=worker(()=>{throw Error('duplicate must not fetch');},db);await push(next);assert.equal(next.shown.length,0);
});
test('denied or offline native content fetch never renders private payload data',async()=>{
 for(const fetcher of [async()=>new Response('',{status:403}),async()=>{throw Error('offline');}]){
  const w=worker(fetcher);await push(w,{delivery:id,token,body:'Untrusted private content'});assert.equal(w.shown[0].body,'Open Bloom to check your notifications.');
 }
});
test('native worker ignores identifier-only or malformed payloads',async()=>{
 const w=worker(()=>{throw Error('must not fetch');});for(const payload of [{delivery:id},{delivery:'../../admin',token},{delivery:id,token:'wrong'}])await push(w,payload);assert.equal(w.shown.length,0);
});
