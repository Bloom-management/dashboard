// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-payment-confirmation';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {AdminPayouts} from './src/components/bloom/admin-payouts';import './src/styles/bloom-cleaner.css';import './src/styles/bloom-application.css';createRoot(document.getElementById('root')).render(<AdminPayouts/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=payouts');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const cleaning={id:'earning',jobId:'job',propertyName:'3620 Trumbull',cleaningDate:new Date().toISOString().slice(0,10),participation:'solo',originalEarningsCents:10000,adjustmentCents:500,paidCents:3000,remainingCents:7500,status:'partial',reviewReason:null,comments:null,adjustments:[{id:'adjustment',amountCents:500,reason:'Extra work',enteredBy:'Admin',createdAt:new Date().toISOString()}]};
const payment={id:'payment',amountCents:3000,method:'Cash',paymentDate:cleaning.cleaningDate,note:'Paid on job day',enteredBy:'Admin',createdAt:new Date().toISOString(),allocations:[{cleaningId:'earning',amountCents:3000,propertyName:cleaning.propertyName,cleaningDate:cleaning.cleaningDate}],voidedAt:null,voidedBy:null,voidReason:null};
const fixture={id:'cleaner',name:'Cleaner',preferredMethod:'Cash',totalDueCents:7500,reviewCount:0,cleanings:[cleaning],payments:[payment],nextPayoutAt:'2026-09-28T12:00:00Z',payoutTimezone:'America/Detroit'};
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:1000}});let posts=[];
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(route.request().method()==='POST'){posts.push(route.request().postDataJSON());return route.fulfill({json:{data:{id:'new-payment'}}});}
   return route.fulfill({json:{data:path==='/api/admin/payouts'?{people:[fixture],totalOutstandingCents:7500,reviewCount:0,unassignedReviewCount:0}:fixture}});
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('button',{name:'Cleaner',exact:true}).click();
  await page.getByRole('article',{name:'3620 Trumbull '+cleaning.cleaningDate}).getByRole('button',{name:'Confirm payment made'}).click();
  const form=page.getByRole('dialog',{name:'Confirm payment made',exact:true});
  await form.waitFor();assert.equal(await form.getByLabel('Payment amount (USD)',{exact:true}).inputValue(),'75.00');
  assert(await form.getByRole('button',{name:'Confirm payment made',exact:true}).isDisabled());assert.equal(posts.length,0);
  await form.getByRole('checkbox',{name:/I confirm/}).check();
  await form.getByRole('button',{name:'Confirm payment made',exact:true}).click();
  await page.getByText('Payment recorded. The cleaner has been notified.',{exact:true}).waitFor();
  assert.equal(posts.length,1);assert.equal(posts[0].amountCents,7500);assert.deepEqual(posts[0].allocations,[{cleaningId:'earning',amountCents:7500}]);
  console.log(`PASS ${width}: prefilled cleaning, explicit confirmation and one allocated payment request`);await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
