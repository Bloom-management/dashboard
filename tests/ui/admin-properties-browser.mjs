// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-admin-properties-visual';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {AdminHub} from './src/components/bloom/admin';import {request} from './src/components/bloom/api';import './src/styles/bloom-cleaner.css';import './src/styles/bloom-application.css';const empty=async()=>({items:[],nextCursor:null});createRoot(document.getElementById('root')).render(<AdminHub integration={{listCities:async()=>[],admin:{properties:empty,users:empty,cityRequests:empty,sources:empty,propertySources:empty,property:async id=>({id,name:'Test property',timezone:'UTC',active:true,isBloomOwned:true,ownerIds:[],address:'Test',instructions:'Test instructions',soloRateCents:5000})}}}/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-only-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=properties');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let data;
   if(path==='/api/me')data={id:'admin',role:'admin',displayName:'Admin'};
   else if(path==='/api/owner/listings')data={items:Array.from({length:12},(_,i)=>({id:'unit-'+i,name:'Test property '+i,timezone:'UTC',active:true,supplies:[],sources:[],suppliesUnavailable:true})),nextCursor:null};
   else if(path.endsWith('/cleaning-config'))data=null;
   else if(path.endsWith('/calendar-review'))data={items:[],nextCursor:null};
   else if(path==='/api/owner/performance')data={totals:{coverage:{status:'unknown',message:'Unknown'},occupiedNights:0}};
   else throw Error(path);
   await route.fulfill({json:{data}});
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('button',{name:'Rate',exact:true}).waitFor();
  assert.equal(await page.locator('.owner-property-card').count(),12);
  await page.getByRole('button',{name:'Maintenance',exact:true}).click();
  assert.equal(await page.locator('.maintenance-card').count(),8);
  if(width===1440){
   const rail=page.locator('.owner-listings-rail'),detail=page.locator('.owner-listing-detail');
   await detail.evaluate(el=>el.scrollTop=200);
   assert.equal(await rail.evaluate(el=>el.scrollTop),0);
   const before=await detail.evaluate(el=>el.scrollTop);
   await rail.evaluate(el=>el.scrollTop=200);
   assert.equal(await detail.evaluate(el=>el.scrollTop),before);
   assert.ok(await rail.evaluate(el=>el.scrollTop)>0);
   assert.ok(before>0);
  }
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByText('Test instructions',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  await page.screenshot({path:out+'/admin-'+width+'.png'});
  console.log('PASS Admin Properties '+width+': shared cards, carousel, admin settings, independent desktop scrolling');
  await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
