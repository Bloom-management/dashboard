/** Original-checkout local lifecycle only. Never resets data or targets a hosted project. */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { parseEnv } from 'node:util';
import net from 'node:net';
import { createInterface } from 'node:readline';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const project='bloom-backend-local', origin='http://127.0.0.1:3000', base='http://127.0.0.1:55441';
const state=join(root,'.bloom-local','process.json');
const action=process.argv[2]??'start';
let child, worker, heartbeat, ownsLock=false, stopping=false;
const lock=join(root,'.bloom-local','runtime.lock');
const workerState=join(root,'.bloom-local','calendar-worker.json');
function alive(pid){try{process.kill(pid,0);return true;}catch{return false;}}
function releaseLock(){if(ownsLock){rmSync(lock,{recursive:true,force:true});ownsLock=false;}}
function acquireLock(){
 mkdirSync(dirname(lock),{recursive:true,mode:0o700});
 if(existsSync(lock)){
  let record;try{record=JSON.parse(readFileSync(join(lock,'owner.json'),'utf8'));}catch{fail('Incomplete runtime lock. Inspect .bloom-local/runtime.lock before retrying.');}
  if(record.root!==root||!Number.isInteger(record.pid)||record.pid<=1)fail('Invalid runtime lock; refusing to replace it.');
  if(alive(record.pid))fail('Bloom local startup is already running. Use its terminal or npm run local:stop.');
  if(existsSync(state)){const previous=JSON.parse(readFileSync(state,'utf8'));if([previous.pid,previous.workerPid].some(pid=>Number.isInteger(pid)&&pid>1&&alive(pid)))fail('A previous Bloom app/worker is still stopping. Retry after it exits.');}
  rmSync(lock,{recursive:true});
 }
 try{mkdirSync(lock,{mode:0o700});}catch{fail('Another Bloom launcher acquired the runtime lock.');}
 ownsLock=true;writeFileSync(join(lock,'owner.json'),JSON.stringify({root,pid:process.pid}),{mode:0o600});
 process.once('exit',releaseLock);
}
function stopChildren(){stopping=true;for(const p of [child,worker])if(p&&!p.killed)p.kill('SIGTERM');}

function fail(message){throw new Error(message);}
function output(message){console.log(`[Bloom local] ${message}`);}
function run(command,args,options={}){
 return new Promise((resolve,reject)=>{
  const p=spawn(command,args,{cwd:root,env:process.env,stdio:['ignore','pipe','pipe'],...options});
  let stdout='',stderr='';
  p.stdout?.on('data',d=>{stdout+=d;});p.stderr?.on('data',d=>{stderr+=d;});
  p.on('error',()=>reject(new Error(`${command} is not available.`)));
  p.on('exit',code=>resolve({code,stdout,stderr}));
 });
}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function requireSuccess(command,args,message){const r=await run(command,args);if(r.code!==0)fail(message);return r.stdout;}
async function dockerReady(){return (await run('docker',['info','--format','{{.ServerVersion}}'])).code===0;}
async function checkDocker(launch){
 const contexts=JSON.parse(await requireSuccess('docker',['context','inspect'],'Install Docker and select the configured local context.'));
 const expected=process.env.BLOOM_DOCKER_CONTEXT;
 if(!expected)fail('Set BLOOM_DOCKER_CONTEXT in .env.local to the existing local Docker context.');
 if(contexts[0].Name!==expected)fail(`Selected Docker context does not match BLOOM_DOCKER_CONTEXT (${expected}). Select the context containing Bloom’s existing data; do not initialize another database.`);
 if(!contexts[0].Endpoints.docker.Host.startsWith('unix://'))fail('A local Unix-socket Docker context is required.');
 if(await dockerReady())return;
 if(!launch)fail('Docker is stopped. No data was changed.');
 if(process.platform!=='darwin'||expected!=='desktop-linux')fail('Start the configured local Docker daemon, then run npm run dev again.');
 output('Starting Docker Desktop; waiting for the existing local daemon…');
 await requireSuccess('open',['-a','Docker'],'Could not open Docker Desktop. Start it, then run npm run dev again.');
 const deadline=Date.now()+120000;
 while(Date.now()<deadline){if(await dockerReady())return;await delay(1000);}
 fail('Docker did not become ready within two minutes. Check Docker Desktop and retry.');
}
async function assertPortFree(){
 await new Promise((resolve,reject)=>{
  const server=net.createServer();server.once('error',()=>reject(new Error('127.0.0.1:3000 is occupied. Use npm run local:stop for the managed Bloom process; unrelated processes are never stopped automatically.')));
  server.listen({host:'127.0.0.1',port:3000,exclusive:true},()=>server.close(resolve));
 });
}
async function waitForApi(){
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){
  try{const r=await fetch(`${base}/rest/v1/`,{headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY},signal:AbortSignal.timeout(2000)});if(r.ok)return;}catch{}
  await delay(500);
 }
 fail('Local Supabase did not pass the Data API readiness check. No app was launched.');
}
async function stopApp(){
 if(!existsSync(state)){await assertPortFree();return;}
 const record=JSON.parse(readFileSync(state,'utf8'));
 if(record.root!==root||!Number.isInteger(record.pid)||record.pid<=1)fail('Invalid local process record; refusing to signal a process.');
 const ps=await run('ps',['-p',String(record.pid),'-o','command=']);
 if(ps.code===0&&ps.stdout.trim()){
  if(!ps.stdout.includes(join(root,'node_modules','next','dist','bin','next'))||!ps.stdout.includes('--hostname 127.0.0.1 --port 3000'))fail('Recorded PID no longer belongs to this Bloom app; refusing to stop it.');
  // Signal the verified launcher so app and polling worker stop together.
  const launcher=Number.isInteger(record.launcher)&&record.launcher>1?await run('ps',['-p',String(record.launcher),'-o','command=']):null;
  if(launcher?.stdout.includes('scripts/local-dev.mjs'))process.kill(record.launcher,'SIGTERM');
  else process.kill(record.pid,'SIGTERM');
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){try{process.kill(record.pid,0);}catch{break;}await delay(200);}
 }
 if(Number.isInteger(record.workerPid)&&record.workerPid>1){
  const deadline=Date.now()+65000;
  while(alive(record.workerPid)&&Date.now()<deadline)await delay(200);
  if(alive(record.workerPid))fail('Bloom worker is still finishing a bounded sync. Retry stop after it exits.');
 }
 if(existsSync(state))unlinkSync(state);
 await assertPortFree();
}
async function main(){
 if(!['start','stop'].includes(action)||process.argv.length>3)fail('Use npm run dev or npm run local:stop. Ports and service targets are fixed.');
 const [major,minor]=process.versions.node.split('.').map(Number);if(major!==24||minor<5)fail('Node 24.5 or newer in the Node 24 release line is required.');
 process.chdir(root);
 const common=execFileSync('git',['rev-parse','--git-common-dir'],{cwd:root,encoding:'utf8'}).trim();
 if(resolve(root,common,'..')!==root)fail('Shared services may only be managed from the original dashboard checkout.');
 if(!existsSync(join(root,'node_modules','next','dist','bin','next')))fail('Dependencies are missing. Run npm ci in the original checkout first.');
 if(!existsSync(join(root,'.env.local')))fail('Create private .env.local using docs/BLOOM_SETUP.md. Existing hosted .env is never rewritten.');
 // Persistent Next development files win over inherited shell-only application values.
 // System variables (PATH, HOME, etc.) are preserved. Docker/PG routing overrides are not.
 for(const k of Object.keys(process.env))if(/^(NEXT_PUBLIC_|CLERK_|SUPABASE_|CALENDAR_|BLOOM_|DOCKER_|PG)/.test(k))delete process.env[k];
 for(const filename of ['.env','.env.development','.env.local','.env.development.local']){
  const path=join(root,filename);if(!existsSync(path))continue;
  for(const [key,value] of Object.entries(parseEnv(readFileSync(path,'utf8'))))if(/^(NEXT_PUBLIC_|CLERK_|SUPABASE_|CALENDAR_|BLOOM_)/.test(key))process.env[key]=value;
 }
 process.env.NODE_ENV='development';
 if(process.env.NEXT_PUBLIC_APP_URL!==origin||process.env.NEXT_PUBLIC_SUPABASE_URL!==base)fail('Persistent app configuration must target http://127.0.0.1:3000 and local Supabase http://127.0.0.1:55441.');
 for(const name of ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','CLERK_SECRET_KEY','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','CLERK_ISSUER_DOMAIN'])if(!process.env[name]||process.env[name].startsWith('replace_'))fail(`${name} needs configuration in .env.local.`);
 if(!process.env.CLERK_SECRET_KEY.startsWith('sk_test_')||!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.startsWith('pk_test_'))fail('This launcher accepts Clerk development keys only.');
 const issuer=Buffer.from(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.slice('pk_test_'.length),'base64').toString().replace(/\$$/,'');
 if(issuer!==process.env.CLERK_ISSUER_DOMAIN)fail('Clerk publishable key and CLERK_ISSUER_DOMAIN do not match.');
 if(action==='stop'){
  await stopApp();await checkDocker(false);
  heartbeat=setInterval(()=>output('Stopping only Bloom local Supabase, preserving its data…'),15000);
  await requireSuccess('npx',['--yes','supabase@2.117.0','stop','--project-id',project],'Local Supabase stop failed. Its data was not reset.');
  clearInterval(heartbeat);output('Bloom app and local Supabase stopped. Data preserved; Docker and unrelated apps left alone.');return;
 }
 acquireLock();
 const source=process.env.BLOOM_CALENDAR_SOURCE_ID;
 const interval=process.env.BLOOM_CALENDAR_INTERVAL_SECONDS??'300';
 if(source && (!/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(source)||!/^\d+$/.test(interval)||Number(interval)<60||Number(interval)>86400))fail('Configure BLOOM_CALENDAR_SOURCE_ID as a source UUID and BLOOM_CALENDAR_INTERVAL_SECONDS from 60 to 86400.');
 if(source && !/^[a-f\d]{64}$/i.test(process.env.CALENDAR_ENCRYPTION_KEY??''))fail('Calendar polling requires the existing CALENDAR_ENCRYPTION_KEY.');
 await assertPortFree();await checkDocker(true);
 const changes=await requireSuccess('git',['status','--porcelain','--','supabase/migrations'],'Cannot inspect local migrations.');
 if(changes.trim())fail('Uncommitted migrations found. Integrate/review them before automatic local startup.');
 heartbeat=setInterval(()=>output('Waiting for Bloom local Supabase readiness…'),15000);
 output('Starting the existing Bloom local Supabase project (no reset)…');
 await requireSuccess('python3',['supabase/local-migrations.py','start'],'Local Supabase start failed. Check Docker and the local profile; no reset was requested.');
 await requireSuccess('python3',['supabase/local-migrations.py','apply'],'Applying committed local migrations failed. No app was launched.');
 const status=JSON.parse(await requireSuccess('npx',['--yes','supabase@2.117.0','status','--output','json','--workdir',root],'Cannot read local service status.'));
 if(status.API_URL!==base||status.ANON_KEY!==process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||status.SERVICE_ROLE_KEY!==process.env.SUPABASE_SERVICE_ROLE_KEY)fail('Local service endpoint/keys do not match .env.local. Review the local configuration; values are withheld.');
 await waitForApi();clearInterval(heartbeat);
 const commit=(await requireSuccess('git',['rev-parse','--short','HEAD'],'Cannot identify checkout.')).trim();
 output(`Ready: original checkout ${commit}, local Supabase 55441, app ${origin}. Ctrl-C stops the app; npm run local:stop also stops Bloom Supabase safely.`);
 mkdirSync(dirname(state),{recursive:true,mode:0o700});
 child=spawn(process.execPath,[join(root,'node_modules','next','dist','bin','next'),'dev','--hostname','127.0.0.1','--port','3000'],{cwd:root,env:process.env,stdio:['inherit','pipe','pipe']});
 // Next request logs may include Clerk handshake JWTs. Never forward those values.
 for(const stream of [child.stdout,child.stderr])createInterface({input:stream}).on('line',line=>{
  const safe=line.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted JWT]').replace(/([?&]__clerk_[^=\s]+)=([^&\s]+)/g,'$1=[redacted]');
  console.log(safe);
 });
 if(source){
  worker=spawn(process.execPath,['--import','tsx',join(root,'src/server/calendar/worker.ts'),'--airbnb-source',source,'--interval-seconds',interval],{cwd:root,env:{...process.env,BLOOM_LOCAL_LAUNCHER_PID:String(process.pid)},stdio:['ignore','pipe','pipe']});
  const report={pid:worker.pid,launcher:process.pid,intervalSeconds:Number(interval),startedAt:new Date().toISOString(),lastCycle:null};
  writeFileSync(workerState,JSON.stringify(report),{mode:0o600});
  createInterface({input:worker.stdout}).on('line',line=>{
   try{const cycle=JSON.parse(line);if(!['success','partial','not_modified','failed'].includes(cycle.status))return;
    report.lastCycle=cycle;writeFileSync(workerState,JSON.stringify(report),{mode:0o600});
    output(`Airbnb poll: ${cycle.status}; created=${cycle.created??0}, updated=${cycle.updated??0}, removed=${cycle.removed??0}, unchanged=${cycle.unchanged??0}${cycle.errorCode?`; code=${cycle.errorCode}`:''}.`);
   }catch{output('Calendar worker returned an unreadable status.');}
  });
  createInterface({input:worker.stderr}).on('line',()=>output('Calendar worker reported a startup error; inspect its local configuration.'));
  worker.on('error',()=>{output('Calendar worker failed to start.');process.exitCode=1;stopChildren();});
  worker.on('exit',code=>{if(!stopping){output('Calendar worker exited unexpectedly; stopping Bloom so polling cannot silently disappear.');process.exitCode=code||1;stopChildren();}});
  output(`Airbnb polling enabled for the configured source, every ${interval}s after each completed run.`);
 }else output('Airbnb polling disabled: set BLOOM_CALENDAR_SOURCE_ID in .env.local to enable it.');
 writeFileSync(state,JSON.stringify({root,pid:child.pid,workerPid:worker?.pid,launcher:process.pid}),{mode:0o600});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stopChildren);
 child.on('error',()=>{output('Next.js failed to start.');process.exitCode=1;stopChildren();});
 child.on('exit',code=>{stopChildren();process.exitCode=process.exitCode||code||0;});
 process.once('exit',()=>{if(existsSync(state)){const saved=JSON.parse(readFileSync(state,'utf8'));if(saved.launcher===process.pid)unlinkSync(state);}});
}
main().catch(error=>{clearInterval(heartbeat);console.error(`[Bloom local] ${error.message}`);stopChildren();releaseLock();process.exitCode=1;});
