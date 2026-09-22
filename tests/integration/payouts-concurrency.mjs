import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';

// Explicit local Docker target. Synthetic LOCAL TEST records only; never a remote DB.
const container = 'supabase_db_bloom-backend-local';
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DOCKER_')));
const context=JSON.parse(execFileSync('docker',['context','inspect'],{encoding:'utf8',env}))[0];
assert.ok(context.Endpoints?.docker?.Host?.startsWith('unix://'),'Requires a local Docker Unix socket');
const inspected=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',env}))[0];
assert.ok(inspected.State?.Running && inspected.NetworkSettings?.Ports?.['5432/tcp']?.some(binding=>binding.HostPort==='55442'),'Requires the Bloom local development database');
const args = ['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-A','-t','-v','ON_ERROR_STOP=1'];
const sql = value => execFileSync('docker',args,{input:value,encoding:'utf8',env}).trim();
const fixture = JSON.parse(sql(`
with actor as (insert into public.users(clerk_user_id,role,display_name,onboarding_completed_at) values('payout-race-admin-'||gen_random_uuid(),'admin','LOCAL TEST Payout concurrency admin',now()) returning *),
actor2 as (insert into public.users(clerk_user_id,role,display_name,onboarding_completed_at) values('payout-race-admin-'||gen_random_uuid(),'admin','LOCAL TEST Payout concurrency admin 2',now()) returning *),
cleaner as (insert into public.users(clerk_user_id,role,display_name,onboarding_completed_at) values('payout-race-cleaner-'||gen_random_uuid(),'cleaner','LOCAL TEST Payout concurrency cleaner',now()) returning *),
p as (insert into public.properties(city_id,name,address,is_bloom_owned) select id,'LOCAL TEST Payout concurrency unit','Development only',true from public.cities where active limit 1 returning *),
j as (insert into public.jobs(property_id,checkout_date,start_at,end_at,timezone_snapshot,solo_rate_cents_snapshot) select p.id,current_date-n,(current_date-n+time '11:00') at time zone 'America/Detroit',(current_date-n+time '15:00') at time zone 'America/Detroit','America/Detroit',1000 from p cross join actor cross join generate_series(1,2) n returning *),
a as (insert into public.assignments(job_id,cleaner_id,slot,completed_pay_cents) select j.id,cleaner.id,1,1000 from j cross join cleaner returning *)
select jsonb_build_object('admin',(select clerk_user_id from actor),'admin2',(select clerk_user_id from actor2),'cleaner',(select id from cleaner),'assignments',(select jsonb_agg(id order by id) from a));
`));
sql(`update public.jobs set status='completed',completed_at=now(),completed_by=(select id from public.users where clerk_user_id='${fixture.admin}') where id in (select job_id from public.assignments where cleaner_id='${fixture.cleaner}');`);
function attempt(actor, assignment, amount, key, hold=false) {
  const data = JSON.stringify({amountCents:amount,method:'Cash',paymentDate:new Date().toISOString().slice(0,10),note:'LOCAL TEST concurrency only',allocations:[{cleaningId:assignment,amountCents:amount}]});
  const input = `begin; select set_config('request.jwt.claims','${JSON.stringify({sub:actor})}',true); select public.bloom_admin_payout_action('${fixture.cleaner}','payment','${data}','${key}'); ${hold?'select pg_sleep(0.6);':''} commit;`;
  return new Promise(resolve=>{
    const proc=spawn('docker',args,{env}); let output='';let error='';
    proc.stdout.on('data',v=>output+=v);proc.stderr.on('data',v=>error+=v);
    proc.on('close',code=>resolve({code,output,error}));proc.stdin.end(input);
  });
}
const [first,second] = await Promise.all([
  attempt(fixture.admin,fixture.assignments[0],700,'race-first',true),
  new Promise(resolve=>setTimeout(resolve,100)).then(()=>attempt(fixture.admin2,fixture.assignments[0],700,'race-second')),
]);
assert.equal([first,second].filter(x=>x.code===0).length,1);
assert.match([first,second].find(x=>x.code!==0).error,/CONFLICT/);
assert.equal(sql(`select paid_cents from private.payout_balances where id='${fixture.assignments[0]}';`),'700');
const replays = await Promise.all([
  attempt(fixture.admin,fixture.assignments[1],600,'same-key',true),
  new Promise(resolve=>setTimeout(resolve,100)).then(()=>attempt(fixture.admin,fixture.assignments[1],600,'same-key')),
]);
assert.ok(replays.every(x=>x.code===0),JSON.stringify(replays));
const ids = replays.map(x=>x.output.match(/\{"id": "([^"]+)"\}/)?.[1]);
assert.ok(ids[0]);assert.equal(ids[0],ids[1]);
assert.equal(sql(`select count(*)||':'||sum(amount_cents) from private.payout_allocations where assignment_id='${fixture.assignments[1]}';`),'1:600');
console.log('PASS separate-admin concurrent payments cannot overallocate; concurrent same-key submissions return one payment. LOCAL TEST records preserved.');
