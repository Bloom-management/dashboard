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

 const result=await page.evaluate(async()=>{const r=await fetch('/api/calendar/add/options');const body=await r.json();return {status:r.status,count:body.data?.properties?.length,error:body.error?.code};});
 assert.equal(result.status,200,JSON.stringify(result));assert(result.count>0);console.log('PASS real Clerk owner session: calendar options HTTP 200 with authorized listings.');
}finally{if(session)await clerk.sessions.revokeSession(session).catch(()=>{});await browser.close();}
