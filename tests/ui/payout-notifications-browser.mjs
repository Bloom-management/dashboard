// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-payout-notifications';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {AdminHub} from './src/components/bloom/admin';import {request} from './src/components/bloom/api';import './src/styles/bloom-cleaner.css';import './src/styles/bloom-application.css';const empty=async()=>({items:[],nextCursor:null});createRoot(document.getElementById('root')).render(<AdminHub integration={{listCities:async()=>[],admin:{properties:empty,users:async()=>({items:[{id:'admin',role:'admin',displayName:'Current admin',email:'admin@example.com'},{id:'owner',role:'owner',displayName:'Test owner',email:'owner@example.com',location:'Detroit'}],nextCursor:null}),cityRequests:empty,sources:empty,propertySources:empty,property:async id=>({id,name:'Test property',timezone:'UTC',active:true,isBloomOwned:true,ownerIds:[],address:'Test',instructions:'Test instructions',soloRateCents:5000})}}}/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-only-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(url){window.location.href=url},replace(url){history.replaceState({},'',url)},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams(window.location.search);",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});let paid=false,failed=false;
  const people=[{id:'cleaner-one',name:'Test Cleaner',totalDueCents:1250,preferredMethod:null,reviewCount:0},{id:'admin-two',name:'Participating Admin',totalDueCents:2500,preferredMethod:'Cash',reviewCount:0},{id:'paid',name:'Paid Cleaner',totalDueCents:0,preferredMethod:null,reviewCount:0}];
  await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;
   if(path==='/api/me')return route.fulfill({json:{data:{id:'admin',role:'admin',displayName:'Admin'}}});
   if(path==='/api/admin/pricing')return route.fulfill({json:{data:[{id:'unit',name:'Pricing Unit'}]}});
   if(path==='/api/admin/payouts'){if(failed)return route.fulfill({status:503,json:{error:{code:'CONFIGURATION_ERROR'}}});return route.fulfill({json:{data:{people:people.map(p=>({...p,totalDueCents:paid?0:p.totalDueCents})),totalOutstandingCents:paid?0:3750,reviewCount:0,unassignedReviewCount:0}}});}
   if(path==='/api/admin/payouts/cleaner-one')return route.fulfill({json:{data:{...people[0],cleanings:[],payments:[]}}});
   return route.fulfill({json:{data:[]}});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/?view=people');
  await page.getByRole('button',{name:'Notifications, 3 need attention',exact:true}).click();
  const link=page.getByRole('link',{name:/Test Cleaner has \$12.50 in outstanding payments/});await link.waitFor();assert.equal(await page.getByRole('link',{name:/Paid Cleaner/}).count(),0);await page.getByRole('link',{name:/Participating Admin has \$25.00/}).waitFor();await page.getByRole('link',{name:/Pricing Unit needs cleaner pricing set/}).waitFor();
  await link.click();const dialog=page.getByRole('dialog',{name:'Cleaner payout details'});await dialog.getByRole('heading',{name:'Test Cleaner',exact:true}).waitFor();assert(page.url().includes('cleaner=cleaner-one'));await dialog.getByRole('button',{name:'Close details'}).click();await dialog.waitFor({state:'hidden'});
  paid=true;await page.evaluate(()=>window.dispatchEvent(new Event('bloom:payouts-changed')));await page.getByRole('button',{name:'Notifications, 1 need attention',exact:true}).click();await page.getByRole('link',{name:/Pricing Unit needs cleaner pricing set/}).waitFor();assert.equal(await page.getByRole('link',{name:/outstanding payments/}).count(),0);
  await page.keyboard.press('Escape');failed=true;await page.getByRole('button',{name:'Notifications, 1 need attention',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByText('You’re all caught up.').count(),0);
  console.log('PASS '+width+': outstanding notification amounts/count, admin participant, paid exclusion, payout dialog link, update event, pricing preservation and honest failure state.');await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
