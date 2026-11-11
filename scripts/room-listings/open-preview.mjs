// Reuses the existing preview browser and authenticated tabs. Never launches Chrome.
import {readFileSync} from 'node:fs';
import {inExistingPreview} from './existing-preview.mjs';
const role=process.argv[2]??'cleaner';if(!['admin','owner','cleaner'].includes(role))throw Error('Use admin, owner or cleaner.');
const atam=process.argv.includes('--atam'),completed=role==='cleaner'&&process.argv.includes('--completed'),otherCleaner=role==='cleaner'&&process.argv.includes('--other-cleaner'),walkthrough=process.argv.includes('--walkthrough');
if(otherCleaner&&!completed)throw Error('--other-cleaner requires --completed.');
if(walkthrough&&(role!=='cleaner'||atam||completed||otherCleaner))throw Error('Use cleaner --walkthrough by itself.');
const fixture=JSON.parse(readFileSync('.bloom-local/private/room-visits-live.json','utf8'));
const walkthroughData=walkthrough?JSON.parse(readFileSync('.bloom-local/private/atam-cleaner-walkthrough.json','utf8')):null;
const otherSubject=otherCleaner?fixture.actors.find(a=>a.role==='cleaner'&&!fixture.assigned.some(c=>c.id===a.id))?.subject:null;
if(otherCleaner&&!otherSubject)throw Error('Other cleaner preview identity unavailable.');
const subject=walkthroughData?.cleanerSubject??otherSubject??(role==='admin'||atam&&role==='owner'?fixture.admin.subject:role==='owner'?fixture.ownerSubject:fixture.preview.cleanerSubject);
const result=await inExistingPreview(async(current,args,browser,{useWindowSize})=>{
 const {role,atam,completed,walkthroughData,fixture,subject,supplies}=args;
 if(!process.env.CLERK_SECRET_KEY?.startsWith('sk_test_')||process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:55441')throw Error('Local development services required.');
 await useWindowSize(current);
 let page;
 for(const context of browser.contexts())for(const candidate of context.pages()){
  if(candidate.url().startsWith('http://localhost:3000/')&&await candidate.evaluate(()=>window.Clerk?.user?.id??null).catch(()=>null)===subject){page=candidate;break;}
 }
 if(!page){
  // Explicit role changes get an isolated context inside the SAME Chrome process.
  const context=await browser.newContext({viewport:null});page=await context.newPage();
  await page.goto('http://localhost:3000/sign-in',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.Clerk?.loaded);
  const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');
  const clerk=require('@clerk/backend').createClerkClient({secretKey:process.env.CLERK_SECRET_KEY});
  let ticket;
  for(let attempt=0;attempt<4;attempt++){try{ticket=await clerk.signInTokens.createSignInToken({userId:subject,expiresInSeconds:90});break;}catch(error){if(error.status!==429||attempt===3)throw error;await new Promise(resolve=>setTimeout(resolve,Math.min(60000,Math.max(1000,(Number(error.retryAfter)||5)*1000))));}}
  const session=await page.evaluate(async token=>{const s=await window.Clerk.client.signIn.create({strategy:'ticket',ticket:token});await window.Clerk.setActive({session:s.createdSessionId});return s.createdSessionId;},ticket.token);
  browser.on('disconnected',()=>void clerk.sessions.revokeSession(session).catch(()=>{}));
 }
 page.setDefaultTimeout(60000);
 let atamDraft;
 if(atam&&role!=='cleaner'){
  const drafts=await page.evaluate(async()=>{const response=await fetch('/api/listing-drafts');if(!response.ok)throw Error('Draft access unavailable');return (await response.json()).data;});
  atamDraft=drafts.find(d=>d.address==='4903 Lincoln Blvd, Dearborn Heights, MI 48125'&&d.identifier==='DH1');if(!atamDraft)throw Error('Atam drafts unavailable to this session');
 }
 let jobId=walkthroughData?.jobId??fixture.preview.jobId,date=walkthroughData?.date??fixture.preview.date;
 if(completed){jobId=fixture.completedJob;const report=await page.evaluate(async id=>{const r=await fetch('/api/jobs/'+id+'/report');if(!r.ok)throw Error('Completed visit access unavailable');return (await r.json()).data;},jobId);date=report.date;}
 const destination=role==='admin'?`/admin?view=properties&property=${atamDraft?.id??fixture.preview.propertyId}`:role==='owner'?'/owner?view=listings':`/cleaner?job=${jobId}&date=${date}`;
 const wanted=new URL('http://localhost:3000'+destination);
 // Preserve the user's current tab/state when already on this job.
 const existing=page.context().pages().find(p=>{const u=new URL(p.url());return u.origin===wanted.origin&&u.pathname===wanted.pathname&&['view','property','job','date'].every(key=>u.searchParams.get(key)===wanted.searchParams.get(key));});
 if(existing)page=existing;else if(page===current&&page.url()!=='http://localhost:3000/sign-in'){
  page=await page.context().newPage();await page.goto(wanted.href,{waitUntil:'domcontentloaded'});
 }else await page.goto(wanted.href,{waitUntil:'domcontentloaded'});
 if(atam&&role!=='cleaner'&&!(await page.locator('dialog').count())){const group=page.getByRole('heading',{name:atamDraft.houseName,exact:true}).locator('..');await group.scrollIntoViewIfNeeded();if(role==='admin')await group.getByRole('button').filter({has:page.getByText(atamDraft.name,{exact:true})}).click();}
 if(supplies&&role==='cleaner'){
  const back=page.getByRole('button',{name:'← Back to cleaning',exact:true});if(await back.count())await back.click();
  const combined=page.getByRole('button',{name:'Supplies & maintenance',exact:true});if(await combined.count()){await combined.click();await page.getByRole('group',{name:'House items'}).getByRole('button',{name:'Supplies',exact:true}).click();}else await page.locator('dialog').last().getByRole('button',{name:'Supplies',exact:true}).click();
 }
 await useWindowSize(page);await page.bringToFront();return {role,url:page.url(),reusedBrowser:true};
},{role,atam,completed,walkthroughData,fixture,subject,supplies:process.argv.includes('--supplies')});
console.log('Reused existing '+result.role+' preview at '+result.url);
