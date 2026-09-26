// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-cleaner-payouts-visual';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {CleanerHub} from './src/components/bloom/cleaner';import './src/styles/bloom-cleaner.css';import './src/styles/bloom-application.css';createRoot(document.getElementById('root')).render(<CleanerHub integration={{listCities:async()=>[{id:'city',name:'Detroit',active:true}]}}/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=payouts');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const cleaning={id:'earning',jobId:'job',propertyName:'3620 Trumbull',cleaningDate:new Date().toISOString().slice(0,10),participation:'solo',originalEarningsCents:10000,adjustmentCents:500,paidCents:3000,remainingCents:7500,status:'partial',reviewReason:null,comments:null,adjustments:[{id:'adjustment',amountCents:500,reason:'Extra work',enteredBy:'Admin',createdAt:new Date().toISOString()}]};
const payment={id:'payment',amountCents:3000,method:'Cash',paymentDate:cleaning.cleaningDate,note:'Paid on job day',enteredBy:'Admin',createdAt:new Date().toISOString(),allocations:[{cleaningId:'earning',amountCents:3000,propertyName:cleaning.propertyName,cleaningDate:cleaning.cleaningDate}],voidedAt:null,voidedBy:null,voidReason:null};
const fixture={id:'cleaner',name:'Cleaner',preferredMethod:'Cash',totalDueCents:7500,reviewCount:0,cleanings:[cleaning],payments:[payment],nextPayoutAt:'2026-09-28T12:00:00Z',payoutTimezone:'America/Detroit'};
try{
 for(const width of [320,390,768,1440]){
  const page=await browser.newPage({viewport:{width,height:1000}});let data=structuredClone(fixture);let failed=false;
  await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;if(path==='/api/cleaner/payouts'&&failed)return route.fulfill({status:503,json:{error:{code:'SERVICE_UNAVAILABLE',message:'Please retry'}}});return route.fulfill({json:{data:path==='/api/me'?{id:'cleaner',role:'cleaner',displayName:'Cleaner',approvedCityId:'city'}:path==='/api/cleaner/payouts'?data:path==='/api/notifications'?{items:[],total:0}:[]}});});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('heading',{name:'Payouts',exact:true}).waitFor();
  await page.getByText('$105.00',{exact:true}).first().waitFor();
  assert.equal(await page.locator('.cp-summary strong').allTextContents().then(x=>x.join(',')),'$105.00,$30.00,$75.00');
  assert.equal(await page.locator('.cp-card').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`overflow at ${width}`);
  await page.getByRole('button',{name:'Payments',exact:true}).click();await page.getByText('Paid on job day',{exact:true}).waitFor();
  data.payments[0].voidedAt=new Date().toISOString();data.payments[0].voidReason='Incorrect record';data.totalDueCents=10500;data.cleanings[0].paidCents=0;data.cleanings[0].remainingCents=10500;
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('Voided',{exact:true}).waitFor();
  assert.equal(await page.locator('.cp-summary strong').allTextContents().then(x=>x.join(',')),'$105.00,$0.00,$105.00');
  await page.screenshot({path:`${out}/payouts-${width}.png`,fullPage:true});
  const tabs=page.getByRole('navigation',{name:'Cleaner views'});assert.equal(await tabs.getByRole('button').count(),3);
  await tabs.getByRole('button',{name:'Available-job calendar'}).click();await page.getByRole('heading',{name:'All properties',exact:true}).waitFor();
  failed=true;await tabs.getByRole('button',{name:'My payouts'}).click();await page.getByRole('button',{name:'Try again'}).waitFor();failed=false;data.cleanings=[];data.payments=[];data.totalDueCents=0;
  await page.getByRole('button',{name:'Try again'}).click();await page.getByRole('heading',{name:'No earnings yet'}).waitFor();
  console.log(`PASS ${width}: cleaner tab, totals, early payment, void sync, white cards, responsive layout, retry and empty state`);await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
