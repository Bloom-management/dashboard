// Local-only manual walkthrough. Copies definitions, never Atam ownership, feeds, codes or reports.
import {createRequire} from 'node:module';import {readFileSync,writeFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';import {previewTicket} from './dev-signin.mjs';
const require=createRequire(import.meta.url);require('@next/env').loadEnvConfig(process.cwd(),true);
assert(process.env.CLERK_SECRET_KEY?.startsWith('sk_test_'));assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:55441');
const logins=JSON.parse(readFileSync('.bloom-local/private/named-test-logins.json','utf8'));
const prior=JSON.parse(readFileSync('.bloom-local/private/room-visits-live.json','utf8'));
const sql=q=>execFileSync('docker',['exec','-i','supabase_db_bloom-backend-local','psql','-U','postgres','-d','postgres','-X','-Atq','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8'}).trim().split('\n').at(-1);
const info=JSON.parse(execFileSync('docker',['inspect','supabase_db_bloom-backend-local'],{encoding:'utf8'}))[0];assert(info.State.Running);assert(info.HostConfig.PortBindings['5432/tcp'].some(p=>p.HostPort==='55442'));
const day=sql("select (now() at time zone 'America/Detroit')::date;");assert(/^\d{4}-\d{2}-\d{2}$/.test(day));
const seed=`begin;
select pg_advisory_xact_lock(hashtextextended('atam-cleaner-walkthrough:${day}',0));
do $$declare src uuid;h uuid;p public.properties;sp public.house_spaces;i public.house_items;pid uuid;sid uuid;props jsonb:='{}';spaces jsonb:='{}';begin
select id into src from houses where address='4903 Lincoln Blvd, Dearborn Heights, MI 48125';
if src is null or (select count(*) from properties where house_id=src and draft_data is not null and deleted_at is null)<>4 then raise exception 'Expected four original Atam drafts';end if;
select id into h from houses where name='LOCAL TEST · Atam walkthrough · ${day}' and created_by='${prior.admin.id}';
if h is null then insert into houses(name,address,timezone,created_by) values('LOCAL TEST · Atam walkthrough · ${day}','LOCAL TEST — 4903 Lincoln Blvd, Dearborn Heights, MI 48125','America/Detroit','${prior.admin.id}') returning id into h;end if;
for p in select * from properties where house_id=src and deleted_at is null order by room_identifier loop
 select id into pid from properties where house_id=h and room_identifier=p.room_identifier and deleted_at is null;
 if pid is null then
  insert into properties(city_id,name,address,timezone,active,is_bloom_owned,solo_rate_cents,house_id,listing_type,room_identifier,room_label,airbnb_cover_url,airbnb_cover_status,cleaning_start_time,cleaning_end_time,default_checkout_time)
  values(p.city_id,'LOCAL TEST · Atam '||p.room_identifier,'LOCAL TEST — 4903 Lincoln Blvd, Dearborn Heights, MI 48125',p.timezone,true,false,p.solo_rate_cents,h,'room',p.room_identifier,null,p.airbnb_cover_url,p.airbnb_cover_status,'00:00','23:59','00:00') returning id into pid;
  insert into property_owners values(pid,'${logins.ownertest.bloomId}');
  insert into property_entry_instructions(property_id,instructions,access_info) values(pid,'Local test walkthrough for '||p.room_identifier||'. Clean the bedroom and shared bathroom, kitchen and living room. Use test photos; do not travel.','{"entryType":"keypad","code":"","entryNotes":"Local walkthrough only. No physical entry required.","parking":[],"garageCode":"","parkingNotes":""}');
 end if;
 props:=props||jsonb_build_object(p.id::text,pid);
end loop;
for sp in select * from house_spaces where house_id=src loop
 select id into sid from house_spaces where house_id=h and kind=sp.kind and property_id is not distinct from (props->>sp.property_id::text)::uuid;
 if sid is null then insert into house_spaces(house_id,property_id,kind,label) values(h,(props->>sp.property_id::text)::uuid,sp.kind,sp.label) returning id into sid;end if;
 spaces:=spaces||jsonb_build_object(sp.id::text,sid);
end loop;
insert into listing_spaces(property_id,space_id) select listing.id,s.id from properties listing join house_spaces s on s.house_id=listing.house_id and (s.property_id is null or s.property_id=listing.id) where listing.house_id=h on conflict do nothing;
for i in select * from house_items where house_id=src and active loop
 insert into house_items(house_id,property_id,space_id,kind,category,name,proposed) values(h,(props->>i.property_id::text)::uuid,(spaces->>i.space_id::text)::uuid,i.kind,i.category,i.name,i.proposed) on conflict do nothing;
end loop;
insert into house_visit_pricing select h,first_host_cents,additional_host_cents,first_pool_cents,additional_pool_cents,0 from house_visit_pricing where house_id=src on conflict do nothing;
end$$;
commit;
select jsonb_build_object('houseId',h.id,'rooms',(select jsonb_agg(jsonb_build_object('id',p.id,'identifier',p.room_identifier) order by p.room_identifier) from properties p where p.house_id=h.id and p.deleted_at is null)) from houses h where h.name='LOCAL TEST · Atam walkthrough · ${day}' and h.created_by='${prior.admin.id}';`;
const prepared=JSON.parse(sql(seed));
const clerk=require('@clerk/backend').createClerkClient({secretKey:process.env.CLERK_SECRET_KEY});const {chromium}=await import(pathToFileURL(process.cwd()+'/.bloom-local/private/browser-tools/node_modules/playwright/index.mjs').href);const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const sessions=[];
async function login(subject){const page=await browser.newPage();page.setDefaultTimeout(60000);await page.goto('http://localhost:3000/sign-in',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.Clerk?.loaded);const ticket=await previewTicket(clerk,subject);sessions.push(await page.evaluate(async token=>{const s=await window.Clerk.client.signIn.create({strategy:'ticket',ticket:token});await window.Clerk.setActive({session:s.createdSessionId});return s.createdSessionId;},ticket.token));return page;}
async function api(page,path,body,key){const r=await page.evaluate(async({path,body,key})=>{const res=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':key},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,body:await res.json()};},{path,body,key});assert.equal(r.status,200,path+': '+JSON.stringify(r.body.error??''));return r.body.data;}
try{
 const admin=await login(prior.admin.subject);let jobId=sql(`select id from jobs where house_id='${prepared.houseId}' and checkout_date='${day}';`);
 for(const room of prepared.rooms){
  const attached=sql(`select count(*) from private.room_turnovers t join jobs j on j.id=t.job_id where t.property_id='${room.id}' and j.checkout_date='${day}';`);
  if(attached!=='0')continue;
  const config=await api(admin,`/properties/${room.id}/spaces`);await api(admin,`/properties/${room.id}/spaces`,{spaces:config.map(s=>({id:s.id,label:s.label,revision:s.revision}))},`walkthrough-spaces:${room.id}`);
  const data={date:day,startTime:'00:00',endTime:'23:59',bloomManaged:true,instructions:'LOCAL TEST — Four-room combined walkthrough. No travel or physical entry required.'};
  const preview=await api(admin,`/properties/${room.id}/calendar-actions`,{action:'preview',data},`walkthrough-preview:${day}:${room.id}`);
  const result=await api(admin,`/properties/${room.id}/calendar-actions`,{action:'create_cleaning',data:{...data,reviewToken:preview.preview.reviewToken}},`walkthrough-create:${day}:${room.id}`);
  assert(result.ok);if(jobId)assert.equal(result.jobId,jobId);jobId=result.jobId;
 }
 const job=JSON.parse(sql(`select jsonb_build_object('id',id,'status',status,'day',checkout_date,'startedAt',started_at,'pool',solo_rate_cents_snapshot,'host',host_charge_cents_snapshot,'assignments',(select count(*) from assignments where job_id=j.id and ended_at is null),'turnovers',(select count(*) from private.room_turnovers where job_id=j.id and included)) from jobs j where j.id='${jobId}';`));assert.equal(job.status,'open');assert.equal(job.assignments,0,'A cleaner already claimed this walkthrough; do not reset it.');assert.equal(job.startedAt,null);assert.equal(job.turnovers,4);assert.equal(job.pool,10500);assert.equal(job.host,14000);
 const counts=JSON.parse(sql(`select jsonb_build_object('supplies',(select count(*) from house_items where house_id='${prepared.houseId}' and kind='supply'),'maintenance',(select count(*) from house_items where house_id='${prepared.houseId}' and kind='maintenance'),'reports',(select count(*) from house_item_reports r join house_items i on i.id=r.item_id where i.house_id='${prepared.houseId}'),'calendars',(select count(*) from calendar_sources s join properties p on p.id=s.property_id where p.house_id='${prepared.houseId}'))`));assert.equal(counts.supplies,22);assert.equal(counts.maintenance,55);assert.equal(counts.reports,0);assert.equal(counts.calendars,0);
 const cleaner=await login(logins.cleanertest.subject);assert.equal((await api(cleaner,'/me')).id,logins.cleanertest.bloomId);const card=(await api(cleaner,`/jobs?from=${day}&to=${day}`)).find(j=>j.id===jobId);assert(card);assert.equal(card.activeCleanerCount,0);assert.equal(card.soloRateCents,10500);assert.equal(card.sharedRateCents,5250);
 // Verify the actual claim procedure for this verified development identity, then roll back.
 const claimed=JSON.parse(sql(`begin;set local role authenticated;set local request.jwt.claims='{"sub":"${logins.cleanertest.subject}","role":"authenticated"}';select bloom_job_action('${jobId}','claim','walkthrough-claim-rollback');rollback;`));assert(claimed.myAssignmentId);assert.equal(sql(`select count(*) from assignments where job_id='${jobId}';`),'0');
 await cleaner.goto(`http://localhost:3000/cleaner?job=${jobId}&date=${day}`,{waitUntil:'domcontentloaded'});await cleaner.getByRole('button',{name:'Claim open cleaning slot 1',exact:true}).waitFor();assert.equal(await cleaner.getByRole('button',{name:'Claim open cleaning slot 1',exact:true}).isEnabled(),true);await cleaner.screenshot({path:'.bloom-local/private/atam-cleaner-walkthrough-unclaimed.png'});
 const result={...prepared,jobId,date:day,cleanerSubject:logins.cleanertest.subject,cleanerId:logins.cleanertest.bloomId,...counts,url:`http://localhost:3000/cleaner?job=${jobId}&date=${day}`};writeFileSync('.bloom-local/private/atam-cleaner-walkthrough.json',JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({ready:true,jobId,date:day,rooms:4,unclaimed:true,soloPayout:105,eachWhenShared:52.5,...counts,url:result.url},null,2));
}finally{for(const session of sessions)await clerk.sessions.revokeSession(session).catch(()=>{});await browser.close();}
