// Read-only summary regression: real development Clerk, local APIs and retained synthetic bookings.
import {previewTicket} from '../../scripts/room-listings/dev-signin.mjs';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);require('@next/env').loadEnvConfig(process.cwd(),true);
assert(process.env.CLERK_SECRET_KEY?.startsWith('sk_test_'));
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:55441');
const fixture=JSON.parse(readFileSync('.bloom-local/private/room-visits-live.json','utf8'));
const other=fixture.actors.find(a=>a.role==='cleaner'&&!fixture.assigned.some(c=>c.id===a.id));assert(other);
const clerk=require('@clerk/backend').createClerkClient({secretKey:process.env.CLERK_SECRET_KEY});
const {chromium}=await import(pathToFileURL(process.cwd()+'/.bloom-local/private/browser-tools/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const sessions=[];
try{for(const assigned of [true,false]){
 const context=await browser.newContext({viewport:{width:1280,height:950}}),page=await context.newPage();page.setDefaultTimeout(45000);
 await page.goto('http://localhost:3000/sign-in',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.Clerk?.loaded);
 const ticket=await previewTicket(clerk,assigned?fixture.preview.cleanerSubject:other.subject);
 sessions.push(await page.evaluate(async token=>{const s=await window.Clerk.client.signIn.create({strategy:'ticket',ticket:token});await window.Clerk.setActive({session:s.createdSessionId});return s.createdSessionId;},ticket.token));
 async function api(path,expected=200,body){const r=await page.evaluate(async({path,body,key})=>{const response=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':key},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};},{path,body,key:randomUUID()});assert.equal(r.status,expected,path+': '+JSON.stringify(r.body.error??''));return r.body.data;}
 const report=await api(`/jobs/${fixture.completedJob}/report`),summary=report.roomSummary;
 assert.equal(summary.rooms.length,4);assert.equal(summary.spaces.length,7);assert(summary.items.some(i=>i.kind==='supply'&&i.scope==='shared'));assert(summary.items.some(i=>i.kind==='maintenance'&&i.scope==='room'));
 assert.equal(JSON.stringify(report).includes('entryNotes'),false);assert.equal(JSON.stringify(report).includes('Synthetic unlocked'),false);
 assert((await api(`/jobs?from=${report.date}&to=${report.date}`)).some(j=>j.id===fixture.completedJob));
 for(const endpoint of ['notes?section=supplies','notes?section=maintenance','photos'])await api(`/jobs/${fixture.completedJob}/${endpoint}`);
 await api(`/jobs/${fixture.completedJob}/notes`,404,{section:'supplies',body:'Unauthorized completed edit'});
 await api(`/jobs/${fixture.completedJob}/photos/upload`,404,{category:'bedrooms',roomId:summary.spaces[0].id,mime:'image/png',bytes:100});
 if(!assigned){await api(`/jobs/${fixture.completedJob}/room-visit`,404);await api(`/house-items?propertyId=${summary.rooms[0].propertyId}&jobId=${fixture.completedJob}`,404);}
 await page.goto(`http://localhost:3000/cleaner?job=${fixture.completedJob}&date=${report.date}`,{waitUntil:'domcontentloaded'});
 const dialog=page.locator('dialog').last();await dialog.getByRole('heading',{name:'Cleaning complete.',exact:true}).waitFor();
 assert.equal(await dialog.getByRole('list',{name:'Cleaning completion progress'}).getByRole('listitem').count(),5);
 for(const width of [390,1280]){await page.setViewportSize({width,height:1100});await page.waitForTimeout(550);assert.equal(await dialog.evaluate(e=>e.scrollWidth>e.clientWidth+1),false);await page.screenshot({path:`.bloom-local/private/room-summary-${assigned?'assigned':'other'}-${width}.png`});}
 for(const kind of ['supply','maintenance']){
  await dialog.getByRole('button',{name:kind==='supply'?'Supplies':'Maintenance',exact:true}).click();
  await dialog.getByRole('button',{name:'Shared',exact:true}).click();
  const sample=summary.items.find(i=>i.kind===kind&&i.scope==='shared');await dialog.getByText(sample.name,{exact:true}).waitFor();
  assert.equal(await dialog.getByRole('button',{name:'Update',exact:true}).count(),0);
  assert.equal(await dialog.getByText('Resource not found.',{exact:true}).count(),0);
  for(const width of [390,1280]){await page.setViewportSize({width,height:1100});await page.waitForTimeout(550);assert.equal(await dialog.evaluate(e=>e.scrollWidth>e.clientWidth+1),false);await page.screenshot({path:`.bloom-local/private/completed-shared-${kind}-${assigned?'assigned':'other'}-${width}.png`});}
  await dialog.getByRole('button',{name:'Room',exact:true}).click();await pickRoom(summary.rooms[1].propertyId);
  await dialog.getByRole('button',{name:'← Back to cleaning',exact:true}).click();
 }
 await page.setViewportSize({width:1280,height:1100});await dialog.getByRole('button',{name:'Room photos',exact:true}).click();
 const photos=await api(`/jobs/${fixture.completedJob}/photos`);
 async function pickRoom(value){await dialog.getByRole('button',{name:/^Room: /}).click();await page.getByRole('menuitemradio',{name:value==='shared'?'Shared spaces':summary.rooms.find(r=>r.propertyId===value).identifier,exact:true}).click();}
 for(const room of [...summary.rooms.map(r=>r.propertyId),'shared']){
  await pickRoom(room);
  const spaces=summary.spaces.filter(s=>room==='shared'?s.scope==='shared':s.propertyId===room);
  const count=photos.filter(p=>p.state==='ready'&&!p.noteContext&&spaces.some(s=>s.id===p.roomId)).length;
  await page.waitForFunction(({count})=>document.querySelectorAll('dialog button').length>0&&[...document.querySelectorAll('dialog button')].filter(b=>b.textContent==='View photo').length===count,{count});
 }
 await dialog.getByRole('button',{name:'View photo',exact:true}).first().click();await dialog.locator('figure img').first().waitFor();
 console.log(`PASS ${assigned?'assigned':'other eligible'} cleaner: five-step completion summary, historical Room/Shared reports, room-filtered real photos; completed writes blocked`);
 await context.close();
}}finally{for(const session of sessions)await clerk.sessions.revokeSession(session).catch(()=>{});await browser.close();}
