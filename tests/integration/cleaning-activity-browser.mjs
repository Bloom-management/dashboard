// Opt-in acceptance: real development Clerk accounts and local Supabase only.
// Requires the existing ignored .bloom-local/private/onboarding-acceptance.json setup.
// Reads completed test fixtures from private-teams-browser.mjs; revokes browser sessions.
import{createRequire}from'node:module';import{readFileSync,writeFileSync}from'node:fs';import{execFileSync}from'node:child_process';import{randomUUID}from'node:crypto';import assert from'node:assert/strict';import{pathToFileURL}from'node:url';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT??process.cwd()+'/.bloom-local/private/browser-tools/node_modules/playwright/index.mjs').href);
const require=createRequire(process.cwd()+'/package.json');require('@next/env').loadEnvConfig(process.cwd(),true);assert(process.env.CLERK_SECRET_KEY.startsWith('sk_test_'));assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:55441');
const clerk=require('@clerk/backend').createClerkClient({secretKey:process.env.CLERK_SECRET_KEY});const f=JSON.parse(readFileSync('.bloom-local/private/onboarding-acceptance.json'));const sql=q=>execFileSync('docker',['exec','supabase_db_bloom-backend-local','psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1','-c',q],{encoding:'utf8'}).trim();const base='http://localhost:3000';const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--host-resolver-rules=MAP localhost 127.0.0.1']});const sessions=[],created=[];let current;const saved={};
async function login(subject){const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();page.setDefaultTimeout(30000);await page.goto(base+'/sign-in');await page.waitForFunction(()=>window.Clerk?.loaded);const t=await clerk.signInTokens.createSignInToken({userId:subject,expiresInSeconds:90});sessions.push(await page.evaluate(async token=>{const s=await window.Clerk.client.signIn.create({strategy:'ticket',ticket:token});await window.Clerk.setActive({session:s.createdSessionId});return s.createdSessionId;},t.token));return page;}
async function api(page,path,body,key=randomUUID(),expected=200){const result=await page.evaluate(async({path,body,key})=>{const r=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':key},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};},{path,body,key});assert.equal(result.status,expected,`${path}: ${result.body.error?.code??result.status}`);return result.body.data;}

try {
 const fixture=JSON.parse(readFileSync('.bloom-local/private/private-team-fixture.json'));
 const owner=await login(f.actors.newOwner.subject),admin=await login(f.admin.subject),other=await login(f.actors.invitedOwner.subject);
 for(const [page,hub] of [[owner,'owner'],[admin,'admin']]){
  const detail=await api(page,'/activity?job='+fixture.job);
  assert.equal(detail.items.length,1);assert.equal(detail.items[0].photos.length,2);
  assert.deepEqual(detail.items[0].photos.map(p=>p.locationLabel).sort(),['kitchen','living_room']);
  let offset=0,notice;
  for(;;){const inbox=await api(page,'/notifications?offset='+offset);notice=inbox.items.find(n=>n.id==='completion:'+fixture.job);if(notice||offset+10>=inbox.total)break;offset+=10;}
  assert(notice);assert.equal(notice.href,'/'+hub+'?view=activity&job='+fixture.job);
  await page.goto(base+'/'+hub+'?view=activity');
  await page.getByRole('heading',{name:'Activity',exact:true}).last().waitFor();
  await page.getByRole('button',{name:/Notifications,/}).click();
  for(let i=0;i<offset/10;i++){await page.getByRole('button',{name:'Next',exact:true}).last().click();await page.waitForTimeout(250);}
  await page.locator('a[href="'+notice.href+'"]').click();
  await page.getByRole('heading',{name:'Completion photos',exact:true}).waitFor();
  await page.waitForFunction(()=>{const imgs=[...document.querySelectorAll('section[aria-label="Completed cleaning activity"] img')];return imgs.length===2&&imgs.every(i=>i.complete&&i.naturalWidth>0);});
  await page.screenshot({path:'.bloom-local/private/activity-'+hub+'-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'.bloom-local/private/activity-'+hub+'-mobile.png'});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  await api(page,'/notifications',{id:notice.id});
  console.log('PASS '+hub+' inbox completion click, room labels, real private Storage image loading, mobile layout, dismissal.');
 }
 await api(other,'/activity?job='+fixture.job,undefined,undefined,404);
 const photo=(await api(owner,'/activity?job='+fixture.job)).items[0].photos[0];
 await api(other,'/jobs/'+fixture.job+'/photos/'+photo.id+'/read-url',{},undefined,404);
 console.log('PASS cross-owner activity and signed photo URL denial.');
}finally{for(const sid of sessions)if(sid)await clerk.sessions.revokeSession(sid).catch(()=>{});await browser.close();}
