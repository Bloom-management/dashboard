// Real development Clerk sign-in; export API mocked. No provider traffic or bookings written.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);require('@next/env').loadEnvConfig(process.cwd(),true);
assert(process.env.CLERK_SECRET_KEY.startsWith('sk_test_'));assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:55441');
const {chromium}=await import(pathToFileURL(process.cwd()+'/.bloom-local/private/browser-tools/node_modules/playwright/index.mjs').href);
const clerk=require('@clerk/backend').createClerkClient({secretKey:process.env.CLERK_SECRET_KEY});
const fixtures=JSON.parse(readFileSync('.bloom-local/private/onboarding-acceptance.json'));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--host-resolver-rules=MAP localhost 127.0.0.1']});
let session;
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);
 await page.goto('http://localhost:3000/sign-in');await page.waitForFunction(()=>window.Clerk?.loaded);
 const ticket=await clerk.signInTokens.createSignInToken({userId:fixtures.actors.newOwner.subject,expiresInSeconds:90});
 session=await page.evaluate(async token=>{const s=await window.Clerk.client.signIn.create({strategy:'ticket',ticket:token});await window.Clerk.setActive({session:s.createdSessionId});return s.createdSessionId;},ticket.token);
 let status={enabled:false,url:null,lastFetchedAt:null,ownerConfirmedAt:null};const actions=[];let clipboard='';
 await page.exposeFunction('captureCalendarClipboard',text=>{clipboard=text;});
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:text=>window.captureCalendarClipboard(text)}}));
 await page.route('**/api/properties/*/calendar-export',async route=>{
  const req=route.request();if(req.method()==='POST'){
   assert(req.headers()['idempotency-key']);const {action}=req.postDataJSON();actions.push(action);
   if(action==='create'||action==='regenerate')status={enabled:true,url:'https://calendar.example.test/'+(action==='create'?'first':'second')+'.ics',lastFetchedAt:null,ownerConfirmedAt:null};
   if(action==='confirm')status.ownerConfirmedAt='2026-10-02T10:00:00Z';
   if(action==='disable')status={enabled:false,url:null,lastFetchedAt:null,ownerConfirmedAt:null};
  }
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:status})});
 });
 await page.goto('http://localhost:3000/owner?view=listings&section=settings');
 await page.getByRole('group',{name:'Setup sections'}).getByRole('button',{name:'Calendar',exact:true}).click();
 const panel=page.getByRole('region',{name:'Export from Bloom'});
 await panel.getByRole('button',{name:'Create calendar link'}).click();
 await panel.getByRole('button',{name:'Copy calendar link'}).click();
 await page.waitForFunction(()=>document.body.textContent.includes('Calendar link copied.'));
 assert.equal(clipboard,status.url);assert.equal(status.ownerConfirmedAt,null);
 assert.match(await panel.innerText(),/Export setup not confirmed/);
 await panel.locator('summary').click();
 assert.match(await panel.innerText(),/Syncing is not immediate/);
 await panel.getByRole('button',{name:'I completed setup in Airbnb'}).click();
 await panel.getByText('Setup marked complete by you. Airbnb availability has not been verified.').waitFor();
 await panel.getByRole('button',{name:'Regenerate link',exact:true}).click();
 const regenerate=panel.getByRole('button',{name:'Confirm regeneration'});assert(await regenerate.isDisabled());
 assert.match(await panel.innerText(),/old link will stop working/);
 await panel.getByRole('checkbox').check();await regenerate.click();
 await panel.getByText('New link created. Reconnect it in Airbnb.').waitFor();assert.equal(status.ownerConfirmedAt,null);
 assert.equal(await panel.getByLabel('Private subscription link').inputValue(),'https://calendar.example.test/second.ics');
 for(const width of [320,375,393,430]){await page.setViewportSize({width,height:852});await panel.scrollIntoViewIfNeeded();assert(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),`export panel overflow at ${width}`);}
 status.lastFetchedAt='2026-10-02T11:00:00Z';await page.reload();await page.getByRole('group',{name:'Setup sections'}).getByRole('button',{name:'Calendar',exact:true}).click();
 await panel.getByText(/Feed last fetched/).waitFor();assert.match(await panel.innerText(),/Export setup not confirmed/);assert.match(await panel.innerText(),/does not confirm that Airbnb applied/);
 assert.deepEqual(actions,['create','confirm','regenerate']);
 console.log('PASS mocked export UI: create/copy without connection claim, owner-reported confirmation, regeneration acknowledgment/reset, fetched distinction, 320/375/393/430px layout. Real Clerk session; no real export or provider checks.');
}finally{if(session)await clerk.sessions.revokeSession(session).catch(()=>{});await browser.close();}
