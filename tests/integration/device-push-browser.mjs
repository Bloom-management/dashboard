// Authenticated development Clerk + local DB. Device receipt is simulated in SQL;
// this does not contact OneSignal or prove physical-phone delivery.
import{createRequire}from'node:module';import{readFileSync}from'node:fs';import{randomUUID,createHash}from'node:crypto';import{spawnSync}from'node:child_process';import{pathToFileURL}from'node:url';import assert from'node:assert/strict';
const require=createRequire(import.meta.url);require('@next/env').loadEnvConfig(process.cwd(),true);
assert(process.env.CLERK_SECRET_KEY.startsWith('sk_test_'));assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:55441');
const sql=s=>{const r=spawnSync('docker',['exec','-i','supabase_db_bloom-backend-local','psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],{input:s,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
const {chromium}=await import(pathToFileURL(process.cwd()+'/.bloom-local/private/browser-tools/node_modules/playwright/index.mjs').href);
const clerk=require('@clerk/backend').createClerkClient({secretKey:process.env.CLERK_SECRET_KEY});const fixtures=JSON.parse(readFileSync('.bloom-local/private/onboarding-acceptance.json'));
const subjects={owner:fixtures.actors.newOwner.subject,admin:fixtures.admin.subject};for(const s of Object.values(subjects))assert(/^user_[a-zA-Z0-9]+$/.test(s));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--host-resolver-rules=MAP localhost 127.0.0.1']});
const sessions=[];let device;const messages=[];
try{
 const page=await browser.newPage({viewport:{width:393,height:852}});page.setDefaultTimeout(30000);
 async function login(subject){await page.goto('http://localhost:3000/sign-in');await page.waitForFunction(()=>window.Clerk?.loaded);const ticket=await clerk.signInTokens.createSignInToken({userId:subject,expiresInSeconds:90});sessions.push(await page.evaluate(async token=>{const s=await window.Clerk.client.signIn.create({strategy:'ticket',ticket:token});await window.Clerk.setActive({session:s.createdSessionId});return s.createdSessionId;},ticket.token));}
 const api=async(path,body)=>page.evaluate(async({path,body})=>{const r=await fetch('/api/push/'+path,body?{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(body)}:{});return {status:r.status,...await r.json()};},{path,body});
 await login(subjects.owner);await page.goto('http://localhost:3000/owner?notifications=1');await page.waitForFunction(()=>document.querySelector('.bloom-push-dialog fieldset')?.disabled===false);assert.equal((await api('settings')).status,200);
 const cookie=(await page.context().cookies()).find(c=>c.name==='bloom_push_device');assert(cookie?.httpOnly);device=createHash('sha256').update(cookie.value).digest('hex');
 const owner=sql(`select id from public.users where clerk_user_id='${subjects.owner}';`);
 sql(`select public.bloom_push_device('${device}','${owner}','proof-session','challenge','{"subscription":"${randomUUID()}","hash":"${'a'.repeat(64)}"}');select public.bloom_push_device('${device}','${owner}','proof-session','verify','{"hash":"${'a'.repeat(64)}"}');`);
 assert.equal((await api('settings')).data.linked,true);
 const message=sql(`insert into private.push_messages(logical_key,user_id,kind,expires_at) values('browser:${randomUUID()}','${owner}','test',now()+interval '1 hour') returning id;`).split('\n')[0];messages.push(message);
 const delivery=sql(`insert into private.push_deliveries(message_id,device_id,generation,state) select '${message}',id,generation,'accepted' from private.push_devices where id='${device}' returning id;`).split('\n')[0];
 const destination=`http://localhost:3000/notifications/open?delivery=${delivery}`;
 await page.goto(destination);await page.waitForURL('**/owner?notifications=1');
 await clerk.sessions.revokeSession(sessions.at(-1));await page.context().clearCookies({name:/^(?!bloom_push_device$)/});await page.goto(destination);await page.waitForURL('**/sign-in?**');
 assert.equal(sql(`select verified from private.push_devices where id='${device}';`),'t');
 await login(subjects.admin);await page.goto('http://localhost:3000/admin');const settings=await api('settings');assert.equal(settings.status,200);assert.equal(settings.data.verified,true);assert.equal(settings.data.linked,true);
 assert.equal(sql(`select count(*) from private.push_device_accounts where device_id='${device}' and enabled;`),'2');
 await page.goto(destination);await page.getByRole('heading',{name:'Switch accounts to view this notification'}).waitFor();
 assert.equal(await page.getByText('Notifications are enabled on this device.',{exact:true}).count(),0);
 const stop=await api('device',{unlink:true});assert.equal(stop.status,200);assert.equal((await api('settings')).data.linked,false);
 assert.equal(sql(`select enabled from private.push_device_accounts where device_id='${device}' and user_id='${owner}';`),'t');
 await api('device',{link:true});assert.equal((await api('settings')).data.linked,true);
 await api('device',{disable:true});assert.equal(sql(`select count(*) from private.push_device_accounts where device_id='${device}' and enabled;`),'0');
 await page.goto(destination);await page.getByText('This notification is no longer available. Open your inbox for current updates.').waitFor();
 console.log('PASS authenticated Clerk owner/admin: persistent device through logout/switch, automatic account linking, matching-account click gate, stop/resume account, disable all. Receipt simulated; no provider sends.');
}finally{
 for(const session of sessions)await clerk.sessions.revokeSession(session).catch(()=>{});await browser.close();
 for(const id of messages)sql(`delete from private.push_deliveries where message_id='${id}';delete from private.push_messages where id='${id}';`);
 if(device)sql(`delete from private.push_devices where id='${device}';`);
}
