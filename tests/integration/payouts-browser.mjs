// Real Clerk development sessions + local app/database only. No production payments.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const {createClerkClient}=require('@clerk/backend');
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT??'/tmp/bloom-header-tools/node_modules/playwright/index.mjs').href);
assert(process.env.CLERK_SECRET_KEY?.startsWith('sk_test_'),'Clerk development instance required');
const databaseURL=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL??'');
assert(['localhost','127.0.0.1'].includes(databaseURL.hostname)&&databaseURL.port==='55441','Local Bloom database required');
const base='http://127.0.0.1:3000';
assert(!process.env.DOCKER_HOST||process.env.DOCKER_HOST.startsWith('unix://'),'Local Docker socket required');
const dockerContext=JSON.parse(execFileSync('docker',['context','inspect'],{encoding:'utf8'}))[0];assert(dockerContext.Endpoints.docker.Host.startsWith('unix://'),'Local Docker context required');
function sql(query){return execFileSync('docker',['exec','supabase_db_bloom-backend-local','psql','-U','postgres','-d','postgres','-Atc',query],{encoding:'utf8'}).trim();}
const clerk=createClerkClient({secretKey:process.env.CLERK_SECRET_KEY});
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const sessions=[];
async function signIn(role){
 const subject=sql(`select clerk_user_id from public.users where role='${role}' ${role==='admin'?'':"and display_name='"+(role==='owner'?'ownertest':'cleanertest')+"'"} order by created_at limit 1`);
 assert(subject.startsWith('user_'),'Existing development identity required');
 const ticket=await clerk.signInTokens.createSignInToken({userId:subject,expiresInSeconds:120});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();
 await page.goto(base+'/sign-in');await page.waitForFunction(()=>window.Clerk?.loaded);
 const sid=await page.evaluate(async token=>{const r=await window.Clerk.client.signIn.create({strategy:'ticket',ticket:token});await window.Clerk.setActive({session:r.createdSessionId});return r.createdSessionId;},ticket.token);
 sessions.push(sid);return page;
}
try{
 const anon=await browser.newPage();assert.equal((await anon.request.get(base+'/api/admin/payouts')).status(),401);await anon.close();
 for(const role of ['owner','cleaner']){const page=await signIn(role);assert.equal((await page.request.get(base+'/api/admin/payouts')).status(),403);const deniedBase=base+'/api/admin/payouts/00000000-0000-4000-8000-000000000001';assert.equal((await page.request.get(deniedBase)).status(),403);for(const suffix of ['/payments','/adjustments','/preference','/payments/00000000-0000-4000-8000-000000000002/void'])assert.equal((await page.request.post(deniedBase+suffix,{headers:{Origin:base,'Idempotency-Key':'payout-denied-'+role},data:{}})).status(),403);console.log('PASS authenticated '+role+' payouts denied');await page.context().close();}
 const page=await signIn('admin');await page.goto(base+'/admin?view=payouts');
 await page.getByRole('heading',{name:'Payouts',exact:true}).waitFor();
 const response=await page.request.get(base+'/api/admin/payouts');assert.equal(response.status(),200);
 const summary=(await response.json()).data;assert(Array.isArray(summary.people));
 console.log('PASS real authenticated admin Payouts tab and summary; review count: '+summary.reviewCount);
 execFileSync('docker',['exec','-i','supabase_db_bloom-backend-local','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:readFileSync(new URL('../../supabase/tests/payouts-browser-fixtures.sql',import.meta.url)),stdio:['pipe','pipe','pipe']});
 const fixtureId=sql("select id from public.users where display_name='LOCAL TEST Payouts browser' order by created_at desc limit 1");assert.match(fixtureId,/^[0-9a-f-]{36}$/);
 const fixtureName='LOCAL TEST Payouts browser '+fixtureId.slice(0,8);
 sql(`update public.users set display_name='${fixtureName}' where id='${fixtureId}'`);
 const getDetail=async()=>{const r=await page.request.get(base+'/api/admin/payouts/'+fixtureId);assert.equal(r.status(),200);return(await r.json()).data;};
 let detail=await getDetail();assert.equal(detail.totalDueCents,19400);assert.equal(detail.cleanings.length,4);assert.equal(detail.reviewCount,1);
 const solo=detail.cleanings.find(c=>c.originalEarningsCents===9000),shared=detail.cleanings.find(c=>c.originalEarningsCents===4100),repeat=detail.cleanings.find(c=>c.originalEarningsCents===6300);
 assert.equal(shared.participation,'shared');assert.equal(solo.participation,'solo');assert(detail.cleanings.every(c=>c.comments.includes('LOCAL TEST')));
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByLabel('Search cleaners').fill(fixtureName);await page.getByRole('button',{name:fixtureName,exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Cleaner payout details'});await dialog.getByRole('heading',{name:fixtureName,exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Edit preferred method'}).click();await dialog.getByLabel('Method',{exact:true}).selectOption('Zelle');await dialog.getByRole('button',{name:'Save preferred method'}).click();await dialog.getByText('Preferred method saved. Past payments keep their recorded method.').waitFor();
 async function recordPayment(items,method,note){
  await dialog.getByRole('button',{name:'Record payment',exact:true}).click();
  const form=dialog.locator('form').filter({has:page.getByRole('button',{name:'Record external payment',exact:true})});
  for(const {cleaning,amount} of items){
   const allocations=detail.cleanings.filter(c=>(c.remainingCents??0)>0&&c.status!=='review');const index=allocations.findIndex(c=>c.id===cleaning.id);
   await form.locator('.payout-allocation').nth(index).getByRole('checkbox').check();
   await form.getByLabel(`Allocate for ${cleaning.propertyName} ${cleaning.cleaningDate}`,{exact:true}).fill((amount/100).toFixed(2));
  }
  await form.getByLabel('Payment amount (USD)',{exact:true}).fill((items.reduce((sum,item)=>sum+item.amount,0)/100).toFixed(2));
  await form.getByLabel('Actual payment method').selectOption(method);await form.getByLabel('Transaction reference or note (optional)').fill(note);
  await form.getByRole('checkbox',{name:/I confirm this payment was made outside Bloom/}).check();await form.getByRole('button',{name:'Record external payment',exact:true}).click();
  await form.waitFor({state:'hidden'});await dialog.getByText('External payment recorded. No money was transferred by Bloom.').waitFor();detail=await getDetail();
 }
 await recordPayment([{cleaning:solo,amount:2500},{cleaning:shared,amount:1000}],'Cash','LOCAL TEST partial payment');assert.equal(detail.totalDueCents,15900);assert.equal(detail.payments.length,1);assert.equal(detail.cleanings.find(c=>c.id===solo.id).remainingCents,6500);assert.equal(detail.cleanings.find(c=>c.id===shared.id).remainingCents,3100);
 const firstPayment=detail.payments[0];
 await dialog.getByRole('button',{name:'Edit preferred method'}).click();await dialog.getByLabel('Method',{exact:true}).selectOption('Venmo');await dialog.getByRole('button',{name:'Save preferred method'}).click();await dialog.getByText('Preferred method saved. Past payments keep their recorded method.').waitFor();detail=await getDetail();assert.equal(detail.preferredMethod,'Venmo');assert.equal(detail.payments[0].method,'Cash');
 const cleaningCard=dialog.getByRole('article',{name:`${repeat.propertyName} ${repeat.cleaningDate}`,exact:true});await cleaningCard.getByRole('button',{name:'Record adjustment',exact:true}).click();await cleaningCard.getByLabel('Adjustment (USD)',{exact:true}).fill('6.00');await cleaningCard.getByLabel('Reason (required)').fill('LOCAL TEST approved extra work');await cleaningCard.getByRole('button',{name:'Record adjustment',exact:true}).click();await dialog.getByText('Adjustment recorded. Original earnings are preserved.').waitFor();detail=await getDetail();assert.equal(detail.totalDueCents,16500);assert.equal(detail.cleanings.find(c=>c.id===repeat.id).originalEarningsCents,6300);
 await recordPayment(detail.cleanings.filter(c=>(c.remainingCents??0)>0).map(cleaning=>({cleaning,amount:cleaning.remainingCents})),'Bank transfer','LOCAL TEST full remaining payment');assert.equal(detail.totalDueCents,0);assert(detail.cleanings.filter(c=>c.status!=='review').every(c=>c.status==='paid'));
 const paymentCard=dialog.getByRole('article',{name:`Payment ${firstPayment.paymentDate} ${firstPayment.id}`,exact:true});await paymentCard.getByRole('button',{name:'Correct / void record'}).click();await paymentCard.getByLabel('Reason (required)').fill('LOCAL TEST correction of mistaken entry');await paymentCard.getByRole('button',{name:'Void payment record'}).click();await dialog.getByText('Payment voided. Its cleaning balances are available again. Record a replacement payment if needed.').waitFor();detail=await getDetail();assert.equal(detail.totalDueCents,3500);assert.equal(detail.payments.length,2);assert(detail.payments.find(p=>p.id===firstPayment.id).voidedAt);assert.equal(detail.cleanings.find(c=>c.id===solo.id).remainingCents,2500);
 mkdirSync('/tmp/bloom-payouts-verification',{recursive:true});
 for(const width of [1440,390]){await page.setViewportSize({width,height:900});await dialog.evaluate(el=>el.scrollTop=0);assert.equal(await dialog.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');assert((await dialog.getByRole('heading',{name:fixtureName,exact:true}).evaluate(el=>getComputedStyle(el).fontFamily)).includes('Plus Jakarta Sans'));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`/tmp/bloom-payouts-verification/admin-${width}.png`});}
 console.log('PASS real admin UI: solo/shared/repeat earnings, unfinished exclusion, review flag, comments, preference, explicit partial allocations, full payment, adjustment, audited void, historical method preservation, mobile/desktop dialog. Fixture '+fixtureId);
 const finalSummary=(await(await page.request.get(base+'/api/admin/payouts')).json()).data;
 const existing=summary.people.filter(p=>!p.name.startsWith('LOCAL TEST Payouts')).map(p=>[p.id,p.totalDueCents]);const finalExisting=finalSummary.people.filter(p=>!p.name.startsWith('LOCAL TEST Payouts')).map(p=>[p.id,p.totalDueCents]);assert.deepEqual(finalExisting,existing);console.log('PASS non-fixture balances unchanged');
}finally{await browser.close();for(const id of sessions){if(id)await clerk.sessions.revokeSession(id);}}
