// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-owner-listings-scroll';await mkdir(out,{recursive:true});
await build({entryPoints:['tests/ui/owner-browser-entry.tsx'],bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-only-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams();",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
 for(const role of ['owner']) for(const width of [320,393,430,1440]) {
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const month=new Date().toISOString().slice(0,7);const properties=[{id:'unit-a',name:'ISOLATED · Lake unit',cityId:'city-a',cityName:'Detroit'},{id:'unit-b',name:'ISOLATED · Empty unit',cityId:'city-b',cityName:'Chicago'}];
  const block={id:'stay-a',propertyId:'unit-a',propertyName:properties[0].name,timezone:'America/Detroit',startDate:`${month}-02`,endDate:`${month}-06`,providers:['airbnb'],kind:'reservation',removed:false,changes:[]};
  const totals={bookedNights:4,blockedNights:2,occupiedNights:6,unbookedNights:null,checkIns:1,occupancy:null,coverage:{status:'unknown',from:`${month}-01`,toExclusive:`${month}-30`,eligibleUnitNights:0,totalUnitNights:29,message:'Calendar coverage is unknown.'},platformShare:[{platform:'airbnb',nights:4,share:2/3},{platform:'vrbo',nights:0,share:0},{platform:'unknown',nights:2,share:1/3}]};
  let saved=false,syncCalls=0;const calls=[];
  const source={id:'source-test',propertyId:'unit-a',provider:'airbnb',enabled:true,lastSuccessAt:null,lastAttemptAt:null,message:null};
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());calls.push(url.pathname+url.search);let data;
   if(url.pathname==='/api/me')data={id:'isolated-owner',role,displayName:'Test account',approvedCityId:null};
   else if(url.pathname==='/api/owner/properties')data=properties;
   else if(url.pathname==='/api/owner/freshness')data=properties.map(p=>({propertyId:p.id,lastSuccessAt:null,message:null}));
   else if(url.pathname==='/api/owner/calendar')data=[block,{...block,id:'blocked-b',providers:['vrbo'],kind:'blocked',startDate:`${month}-04`,endDate:`${month}-08`}];
   else if(url.pathname==='/api/owner/performance')data={from:url.searchParams.get('from'),toExclusive:url.searchParams.get('toExclusive'),totals,properties:properties.map(p=>({...totals,propertyId:p.id,propertyName:p.name})),assumption:'Blocks count occupied.'};
   else if(url.pathname==='/api/owner/listings')data={items:properties.map(p=>({...p,timezone:'America/Detroit',active:true,supplies:[{supplyId:'soap',name:'Test soap',level:null,reportedAt:null},{supplyId:'towels',name:'Test towels',level:'low',reportedAt:'2026-09-18T16:00:00Z'}],nightlyGuestRateCents:null,hostPayoutCents:null,currency:'USD',sources:saved&&p.id==='unit-a'?[source]:[]})),nextCursor:null};
   else if(url.pathname.endsWith('/cleaning-config'))data={version:1,rooms:[{id:'bed-1',type:'bedrooms',label:'',requiredPhoto:true},{id:'bed-2',type:'bedrooms',label:'',requiredPhoto:true},{id:'kitchen',type:'kitchen',label:'Kitchen 1',requiredPhoto:true},{id:'living',type:'living_room',label:'Family lounge',requiredPhoto:true}],supplies:[]};
   else if(url.pathname.endsWith('/calendar-sources')){if(req.method()==='POST'){assert.deepEqual(Object.keys(req.postDataJSON()),['url']);assert.ok(req.headers()['idempotency-key']);saved=true;data=source;}else data={items:saved?[source]:[],nextCursor:null};}
   else if(url.pathname.endsWith('/sync')){syncCalls++;if(syncCalls===1){await route.fulfill({status:502,json:{error:{code:'SOURCE_UNAVAILABLE',message:'Calendar unavailable. Retry sync.'}}});return;}data={status:'success',runId:'test-run',created:2,updated:0,removed:0,unchanged:0,conflicts:0};}
   else if(url.pathname.endsWith('/people'))data={bloomOwned:false,members:[],invitations:[]};
   else throw Error(`Unexpected owner call ${url.pathname}`);
   await route.fulfill({json:{data}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  if(width<=700){await page.getByRole('button',{name:'Owner view: Calendar'}).click();await page.getByRole('menuitemradio',{name:'Listings',exact:true}).click();}else await page.getByRole('button',{name:'Listings',exact:true}).click();
  const detail=page.locator('.owner-listing-detail');const save=page.getByRole('button',{name:'Save nightly rate',exact:true});await save.waitFor();
  if(width<=700){
   assert.equal(await detail.evaluate(el=>getComputedStyle(el).maxHeight),'none');assert.equal(await detail.evaluate(el=>getComputedStyle(el).overflowY),'visible');
   assert.equal(await page.locator('.owner-listings-main').evaluate(el=>getComputedStyle(el).overflowY),'visible');
   for(const height of [900,650]){await page.setViewportSize({width,height});await save.scrollIntoViewIfNeeded();const box=await save.boundingBox();assert(box.y>=0&&box.y+box.height<=height,'Save control must be reachable');assert.equal(await detail.evaluate(el=>el.scrollTop),0,'No nested detail scrolling');assert(await page.evaluate(()=>scrollY)>0);}
   await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));const box=await detail.boundingBox();assert(box.y+box.height<=650,'Full detail pane must scroll above viewport bottom');
  }else{assert.equal(await detail.evaluate(el=>getComputedStyle(el).overflowY),'auto');}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);console.log('PASS '+width+': complete listing reachable with mobile page scroll; desktop pane preserved');await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
