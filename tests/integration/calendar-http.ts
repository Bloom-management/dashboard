/** Real LOCAL PostgREST transport; synthetic records are removed in finally.
 * Does not claim Clerk-session or Storage verification. Never fetches a live feed.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {rpcStore,serviceRpc} from '../../src/server/calendar/store';
import {protectUrl} from '../../src/server/calendar/secrets';
import type {Snapshot,Lease} from '../../src/server/calendar/types';
const base=process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(base,'http://127.0.0.1:55441','Local Supabase only');
const actor=randomUUID(),property=randomUUID();
const env:NodeJS.ProcessEnv={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DOCKER_')&&!key.startsWith('PG')&&!key.startsWith('SUPABASE_'))),NODE_ENV:process.env.NODE_ENV??'test'};
execFileSync('python3',['supabase/local-migrations.py','check'],{env,stdio:['ignore','pipe','pipe']});
function sql(input:string){return execFileSync('docker',['exec','-i','supabase_db_bloom-backend-local','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1','-At'],{input,encoding:'utf8',env,stdio:['pipe','pipe','pipe']}).trim();}
const store=rpcStore(serviceRpc(),actor);
let seeded=false;
try{
 sql(`begin;insert into public.users(id,clerk_user_id,role,display_name) values('${actor}','integration_${actor}','admin','Integration fixture');insert into public.properties(id,city_id,name,address,timezone) values('${property}','00000000-0000-4000-8000-000000000001','Integration fixture','Synthetic','America/Detroit');commit;`);seeded=true;
 const input={propertyId:property,provider:'airbnb' as const,...protectUrl('https://www.airbnb.com/calendar/ical/1.ics?t=synthetic','airbnb',property)};
 const source=await store.addSource(input,'setup');assert.equal((await store.addSource(input,'setup')).id,source.id);
 assert.ok((await store.listSources()).items.some(s=>s.id===source.id));assert.ok((await store.enabledSourceIds()).ids.includes(source.id));
 await assert.rejects(rpcStore(serviceRpc(),randomUUID()).listSources(),{code:'FORBIDDEN',status:403});
 const anon=await fetch(`${base}/rest/v1/rpc/bloom_calendar_sources`,{method:'POST',headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,Authorization:`Bearer ${process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({p_actor:actor,p_cursor:null})});assert.ok([401,403,404].includes(anon.status));
 console.log('PASS real source setup, identity replay, lists and role denial');
 const starts=await Promise.allSettled([store.beginSync(source.id,'start-a'),store.beginSync(source.id,'start-b')]);
 assert.equal(starts.filter(r=>r.status==='fulfilled').length,1);
 const success=starts.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<Lease>;
 const lease=success.value;
 const snapshot:Snapshot={complete:true,coverage:null,issues:[],events:[{uid:'synthetic-reservation',recurrenceKey:'',startDate:'2030-05-01',endDate:'2030-05-03',kind:'reservation',status:'active',evidence:'airbnb-reservation-link',reviewRequired:false,contentHash:createHash('sha256').update('synthetic').digest('hex')}]};
 const finishes=await Promise.all([store.finishSync(lease,snapshot,{etag:'synthetic'}),store.finishSync(lease,snapshot,{etag:'synthetic'})]);assert.deepEqual(finishes[0],finishes[1]);assert.equal(finishes[0].created,1);
 const next=await store.beginSync(source.id,'repeat');assert.ok(!('result'in next));const repeated=await store.finishSync(next,snapshot,{etag:'synthetic'});assert.equal(repeated.created,0);assert.equal(repeated.unchanged,1);
 assert.equal(sql(`select count(*) from public.jobs where property_id='${property}';`),'1');
 const cached=await store.beginSync(source.id,'not-modified');assert.ok(!('result'in cached));assert.equal((await store.finishSync(cached,null,{})).status,'not_modified');
 const partial=await store.beginSync(source.id,'partial');assert.ok(!('result'in partial));assert.equal((await store.finishSync(partial,{...snapshot,complete:false,issues:[{code:'INVALID_CALENDAR'}]},{})).status,'partial');
 const blocked=await store.beginSync(source.id,'blocked');assert.ok(!('result'in blocked));
 await assert.rejects(store.finishSync(blocked,{...snapshot,events:[{...snapshot.events[0],kind:'unknown',evidence:'unverified',reviewRequired:true}]},{}),{code:'CONFIGURATION_ERROR',status:503});await store.failSync(blocked,'SYNC_FAILED');
 const health=(await store.listSources()).items.find(s=>s.id===source.id);assert.equal(health?.errorCode,'SYNC_FAILED');
 console.log('PASS real concurrent leases/finish, repeat sync, 304, partial, policy gate and failure health');
}finally{
 if(seeded){
  // Test fixture only, under one local transaction. Bypass immutable audit DELETE
  // triggers solely to remove the random fixture; never touch real property IDs.
  sql(`begin;set local session_replication_role=replica;
  delete from public.job_event_history where job_id in(select id from public.jobs where property_id='${property}');
  delete from public.job_history where job_id in(select id from public.jobs where property_id='${property}');
  delete from public.calendar_changes where event_id in(select e.id from public.calendar_events e join public.calendar_sources s on s.id=e.source_id where s.property_id='${property}');
  delete from public.job_events where job_id in(select id from public.jobs where property_id='${property}');
  delete from public.calendar_event_history where event_id in(select e.id from public.calendar_events e join public.calendar_sources s on s.id=e.source_id where s.property_id='${property}');
  delete from public.calendar_events where source_id in(select id from public.calendar_sources where property_id='${property}');
  delete from public.calendar_operation_receipts where actor_key='${actor}';
  update public.calendar_sources set active_run_id=null where property_id='${property}';
  delete from public.calendar_sync_runs where source_id in(select id from public.calendar_sources where property_id='${property}');
  delete from public.calendar_sources where property_id='${property}';
  delete from public.jobs where property_id='${property}';delete from public.properties where id='${property}';delete from public.users where id='${actor}';commit;`);
  console.log('Removed only the synthetic calendar fixture.');
 }
}
