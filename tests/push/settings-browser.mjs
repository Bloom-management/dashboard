// Actual Chrome layout and production React components; API, permission, and Clerk are mocked.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT??'.bloom-local/private/browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-push-ui';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {PushSettings} from './src/components/push/settings';import './src/styles/bloom-application.css';import './src/styles/bloom-cleaner.css';createRoot(document.getElementById('root')).render(<main className={new URLSearchParams(location.search).get('wrapper')}><PushSettings hideCard/></main>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:out+'/app.js',platform:'browser',format:'esm',jsx:'automatic',external:['/fonts/*'],plugins:[{name:'framework-stubs',setup(b){b.onResolve({filter:/^(next\/(link|navigation)|@clerk\/nextjs)$/},x=>({path:x.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default p=>React.createElement('a',p);export const useRouter=()=>({});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams();export const useAuth=()=>{const identity=React.useSyncExternalStore(fn=>{window.addEventListener('test:auth',fn);return()=>window.removeEventListener('test:auth',fn)},()=>window.testIdentity??'a');return {userId:identity.split(':')[0],sessionId:identity};};",resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(out+req.url));}else{res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const role of ['admin','owner','cleaner'])for(const width of [375,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});let settings={accountId:'account-a',accountName:'Account A',role,opportunities:role==='cleaner',pushEnabled:true,verified:false,linked:false,newJobs:true,reminders:true,completions:true,starts:true,configured:true,appId:'synthetic'};
  await page.addInitScript(()=>{Object.defineProperty(Notification,'permission',{get:()=>window.mockPermission??'denied'});});
  await page.route('https://cdn.onesignal.com/**',r=>r.fulfill({contentType:'text/javascript',body:"window.OneSignalDeferred.forEach(fn=>fn({init:async()=>{},Notifications:{requestPermission:async()=>{window.mockPermission='granted'}},User:{PushSubscription:{optedIn:true}}}));"}));
  await page.route('**/api/**',async r=>{if(r.request().method()==='POST'){const body=r.request().postDataJSON();assert.equal(body.accountId,'account-a');if(r.request().url().endsWith('/test'))return r.fulfill({status:502,json:{error:{code:'SOURCE_UNAVAILABLE',message:'raw-provider-error'}}});if(body.link)settings.linked=true;else if(body.unlink)settings.linked=false;else settings={...settings,...body};}await r.fulfill({json:{data:settings}});});
  await page.goto(`http://127.0.0.1:${server.address().port}/?wrapper=bloom-${role}`);
  await page.waitForTimeout(100);assert.equal(await page.getByRole('alert').count(),0); // hidden settings produce no header errors
  await page.evaluate(()=>window.dispatchEvent(new Event('bloom:notification-settings')));
  const dialog=page.getByRole('dialog',{name:'Notifications',exact:true});await dialog.waitFor();
  const master=dialog.getByRole('switch',{name:'Enable push notifications',exact:true});assert(await master.isChecked());
  assert.equal(await dialog.getByText('Push notifications are on for your account. Enable this device to receive them here.',{exact:true}).count(),0);assert.equal(await dialog.getByRole('button',{name:'Enable on this device'}).count(),0);
  await master.click();await page.waitForTimeout(80);
  await page.evaluate(()=>{window.mockPermission='granted';window.dispatchEvent(new Event('focus'));});await page.waitForTimeout(80);await master.click();
  await dialog.getByText('Device settings',{exact:true}).click();await dialog.getByText('Couldn’t enable notifications on this device. Try again.',{exact:true}).waitFor();assert(!settings.linked);assert(await master.isChecked());
  assert(await dialog.getByRole('switch',{name:'Completed cleanings',exact:true}).isEnabled());
  await dialog.getByRole('switch',{name:'Completed cleanings',exact:true}).click();await page.waitForTimeout(80);assert(!settings.completions);
  await master.click();await page.waitForTimeout(80);assert(!settings.pushEnabled);
  const categorySwitches=dialog.getByRole('group',{name:'Notification categories'}).getByRole('switch');
  for(const category of await categorySwitches.all()){assert(!(await category.isChecked()));assert(await category.isDisabled());}
  assert(settings.starts&&settings.reminders&&settings.newJobs); // saved choices survive the master being off
  assert.equal(await dialog.getByRole('alert').count(),0);
  await master.click();await page.waitForTimeout(80);assert(settings.pushEnabled);assert(!(await dialog.getByRole('switch',{name:'Completed cleanings',exact:true}).isChecked()));
  assert(await dialog.getByRole('switch',{name:role==='cleaner'?'New available jobs':'Cleaning started',exact:true}).isChecked());
  // Simulate a previously proven registration. Test failure must preserve it and the master.
  settings={...settings,pushEnabled:true,verified:true,linked:true};await page.evaluate(()=>{window.mockPermission='granted';window.dispatchEvent(new Event('focus'));});await page.waitForTimeout(80);
  await dialog.getByRole('button',{name:'Send test notification',exact:true}).click();await dialog.getByText('Couldn’t send a test notification. Try again.',{exact:true}).waitFor();assert(await master.isChecked());assert(settings.verified&&settings.linked);
  assert.equal(await dialog.getByText('raw-provider-error').count(),0);assert.equal(await dialog.getByRole('alert').count(),1);
  const metrics=await dialog.evaluate(el=>{const b=el.getBoundingClientRect(),title=el.querySelector('h2').getBoundingClientRect();return {width:b.width,x:b.x,inset:title.x-b.x,radius:parseFloat(getComputedStyle(el).borderRadius),overflow:el.scrollWidth>el.clientWidth};});assert(metrics.radius>0&&metrics.inset>=20&&!metrics.overflow&&metrics.width<=width,JSON.stringify(metrics));
  await dialog.getByRole('button',{name:'Disconnect this account from this device'}).click();await page.waitForTimeout(80);assert(!settings.linked&&settings.pushEnabled);await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await page.getByRole('alert').count(),0);
  console.log(`PASS mocked ${role} ${width}: account/device separation, all categories off with the master, preserved choices on re-enable, test failure isolation, rounded inset dialog without overflow.`);await page.close();
 }
 // A delayed native permission result cannot enroll the newly viewed account.
 const page=await browser.newPage({viewport:{width:390,height:844}});let account='a',links=0,pushEnabled=false;
 await page.addInitScript(()=>{Object.defineProperty(Notification,'permission',{get:()=>window.mockPermission??'default'});Notification.requestPermission=()=>new Promise(resolve=>{window.releasePermission=()=>{window.mockPermission='granted';resolve('granted');};});});
 await page.route('https://cdn.onesignal.com/**',r=>r.fulfill({contentType:'text/javascript',body:"window.OneSignalDeferred.forEach(fn=>fn({init:async()=>{},Notifications:{requestPermission:()=>new Promise(resolve=>{window.releasePermission=resolve})},User:{PushSubscription:{id:'sub',optedIn:true,optIn:async()=>{}}}}));"}));
 await page.route('**/api/**',async r=>{if(r.request().method()==='POST'){if(r.request().url().endsWith('/device'))links++;else pushEnabled=r.request().postDataJSON().pushEnabled??pushEnabled;}await r.fulfill({json:{data:{accountId:account,accountName:'Account '+account,role:'cleaner',opportunities:true,pushEnabled,verified:true,linked:false,subscriptionId:'sub',configured:true,appId:'synthetic'}}});});
 await page.goto(`http://127.0.0.1:${server.address().port}/?notifications=1`);
 await page.getByRole('switch',{name:'Enable push notifications',exact:true}).click();await page.waitForFunction(()=>!!window.releasePermission);
 account='b';await page.evaluate(()=>{window.testIdentity='b';window.dispatchEvent(new Event('test:auth'));});await page.waitForTimeout(80);await page.evaluate(()=>window.releasePermission());await page.waitForTimeout(80);assert.equal(links,0);
 await page.evaluate(()=>window.dispatchEvent(new Event('bloom:notification-settings')));await page.getByText('Account b',{exact:true}).waitFor();
 // Session renewal for the same account does not connect or disconnect devices.
 await page.evaluate(()=>{window.testIdentity='b:renewed';window.dispatchEvent(new Event('test:auth'));});await page.waitForTimeout(80);assert.equal(links,0);await page.close();
 console.log('PASS mocked account switch and session renewal during delayed enrollment: no device-link mutation.');
 // Native browser APIs and HTTP are explicitly mocked here; this verifies UI orchestration only.
 for(const delayed of [false,true]){
  const nativePage=await browser.newPage({viewport:{width:390,height:844}});let activeAccount='a',enrollments=0;
  let nativeStatus={accountId:'a',accountName:'Account a',role:'cleaner',opportunities:true,pushEnabled:false,verified:false,linked:false,transport:'onesignal',nativeEnabled:true,configured:true,vapidPublicKey:Buffer.alloc(65,4).toString('base64url')};
  await nativePage.addInitScript(delayed=>{
   Object.defineProperty(Notification,'permission',{get:()=>'granted'});
   const subscription={toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/synthetic',keys:{auth:'synthetic',p256dh:'synthetic'}})};
   let current=null;const registration={active:{},pushManager:{getSubscription:async()=>current,subscribe:()=>delayed?new Promise(resolve=>{window.completeNativeSubscription=()=>{current=subscription;resolve(subscription);};}):Promise.resolve(current=subscription)}};
   Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>registration,getRegistration:async()=>registration}});
  },delayed);
  await nativePage.route('**/api/**',async route=>{
   const body=route.request().method()==='POST'?route.request().postDataJSON():null;
   if(route.request().url().endsWith('/enroll')){
    enrollments++;assert.equal(body.accountId,activeAccount);assert.equal(body.sessionId,activeAccount);
    if(body.action==='start')return route.fulfill({json:{data:{nonce:'a'.repeat(64)}}});
    assert.equal(body.nonce,'a'.repeat(64));assert.equal(body.subscription.endpoint,'https://fcm.googleapis.com/fcm/send/synthetic');nativeStatus={...nativeStatus,verified:true,linked:true,transport:'native'};
   }else if(body)nativeStatus={...nativeStatus,...body};
   await route.fulfill({json:{data:{...nativeStatus,accountId:activeAccount,accountName:'Account '+activeAccount}}});
  });
  await nativePage.goto(`http://127.0.0.1:${server.address().port}/?notifications=1`);
  const nativeDialog=nativePage.getByRole('dialog',{name:'Notifications',exact:true});await nativeDialog.waitFor();
  await nativeDialog.getByRole('switch',{name:'Enable push notifications',exact:true}).click();
  if(delayed){
   await nativePage.waitForFunction(()=>!!window.completeNativeSubscription);activeAccount='b';
   await nativePage.evaluate(()=>{window.testIdentity='b';window.dispatchEvent(new Event('test:auth'));});
   await nativePage.waitForTimeout(80);await nativePage.evaluate(()=>window.completeNativeSubscription());await nativePage.waitForTimeout(150);
   assert.equal(enrollments,0);
  }else{
   await nativeDialog.getByText('Device enabled.',{exact:true}).waitFor();assert.equal(enrollments,2);assert(nativeStatus.pushEnabled&&nativeStatus.verified&&nativeStatus.linked);
   assert.equal(await nativeDialog.getByText(/verification|delivery confirmed/i).count(),0);
  }
  await nativePage.close();console.log('PASS mocked native '+(delayed?'delayed subscription account isolation':'automatic permission/subscription/nonce enrollment flow')+'. No provider receipt evidence.');
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
