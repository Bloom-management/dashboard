// Authenticated development Clerk + local Supabase. No provider sends.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);require('@next/env').loadEnvConfig(process.cwd(),true);
assert(process.env.CLERK_SECRET_KEY.startsWith('sk_test_'));assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:55441');
const {chromium}=await import(pathToFileURL(process.cwd()+'/.bloom-local/private/browser-tools/node_modules/playwright/index.mjs').href);
const clerk=require('@clerk/backend').createClerkClient({secretKey:process.env.CLERK_SECRET_KEY});
const fixtures=JSON.parse(readFileSync('.bloom-local/private/onboarding-acceptance.json'));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--host-resolver-rules=MAP localhost 127.0.0.1']});
const sessions=[];
try{
 for(const [role,subject] of [['owner',fixtures.actors.newOwner.subject],['admin',fixtures.admin.subject]]){
  const page=await browser.newPage({viewport:{width:393,height:852}});page.setDefaultTimeout(30000);
  await page.goto('http://localhost:3000/sign-in');await page.waitForFunction(()=>window.Clerk?.loaded);
  const ticket=await clerk.signInTokens.createSignInToken({userId:subject,expiresInSeconds:90});
  sessions.push(await page.evaluate(async token=>{const s=await window.Clerk.client.signIn.create({strategy:'ticket',ticket:token});await window.Clerk.setActive({session:s.createdSessionId});return s.createdSessionId;},ticket.token));
  await page.goto(`http://localhost:3000/${role}?notifications=1`);
  const dialog=page.getByRole('dialog',{name:'Job notification settings'});await dialog.waitFor();
  const checkbox=dialog.getByRole('checkbox',{name:'Cleaning completed for my properties or assignments'});await checkbox.waitFor();
  await page.waitForFunction(()=>!document.querySelector('.bloom-push-dialog fieldset')?.disabled);
  assert.equal(await dialog.getByRole('checkbox',{name:'New available jobs in my approved city'}).count(),0);
  const before=await checkbox.isChecked();await checkbox.click();await page.waitForFunction(()=>!document.querySelector('.bloom-push-dialog fieldset')?.disabled);assert.equal(await checkbox.isChecked(),!before);
  const result=await page.evaluate(async()=>{const r=await fetch('/api/push/settings');return {status:r.status,data:(await r.json()).data};});assert.equal(result.status,200);assert.equal(result.data.role,role);assert.equal(result.data.completions,!before);
  await checkbox.click();await page.waitForFunction(()=>!document.querySelector('.bloom-push-dialog fieldset')?.disabled);
  assert.equal(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth),true);
  await page.keyboard.press('Escape');await page.getByRole('button',{name:/^Notifications(?:,|$)/}).click();
  await page.getByRole('button',{name:role==='admin'?'Delivery diagnostics':'Notification settings',exact:true}).click();
  if(role==='admin')await page.getByRole('button',{name:'Notification settings',exact:true}).click();
  await dialog.waitFor();
  console.log(`PASS authenticated ${role}: registration/settings API, completion preference, mobile dialog and notification gear.`);
  if(role==='owner'){
   const forbidden=await page.evaluate(async key=>{const r=await fetch('/api/admin/push');const tick=await fetch('/api/push/tick',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:'{}'});return [r.status,tick.status];},randomUUID());assert.equal(forbidden[0],403);assert(forbidden[1]!==200);
  }
  await page.close();
 }
}finally{for(const sessionId of sessions)await clerk.sessions.revokeSession(sessionId).catch(()=>{});await browser.close();}
