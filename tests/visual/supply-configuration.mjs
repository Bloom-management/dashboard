// Mocked browser UI. Database authorization/retries: tests/integration/supply-purchases.sql.
import {build} from 'esbuild';import {createServer} from 'node:http';import {readFile,mkdir} from 'node:fs/promises';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT??'/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-supply-configuration';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{OwnerSupplySummary}from'./src/components/bloom/owner-listings';import './src/styles/bloom-application.css';import './src/styles/bloom-owner.css';createRoot(document.getElementById('root')).render(<div className="bloom-owner"><OwnerSupplySummary listing={{id:'property',name:'Test property',timezone:'America/Detroit',supplies:[]}} onChanged={()=>{window.saved=true;}}/></div>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,outfile:out+'/app.js',platform:'browser',format:'esm',jsx:'automatic',external:['/fonts/*'],plugins:[{name:'next-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from'react';export default p=>React.createElement('a',p);export const useRouter=()=>({});export const usePathname=()=>'/owner';export const useSearchParams=()=>new URLSearchParams();",resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(out+req.url));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const width of [320,375,393,768,1440]){
  const page=await browser.newPage({viewport:{width,height:844}});
  await page.route('**/api/**',route=>route.fulfill({json:{data:null}}));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'Add supply',exact:true}).click();
  const message=page.getByText("Finish room setup in this property's Settings first, then add supplies here.",{exact:true});await message.waitFor();
  for(const hub of ['bloom-owner','bloom-cleaner']){
   await page.locator('#root > div').evaluate((el,hub)=>el.className=hub,hub);
   const dialog=await page.getByRole('dialog').boundingBox();const text=await message.boundingBox();const close=await page.locator('[data-bloom-dialog-close]').boundingBox();
   assert(text.x-dialog.x>=19);assert(dialog.x+dialog.width-text.x-text.width>=19);assert(text.y>=close.y+close.height);
   assert(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));
   assert(await page.getByRole('heading',{name:'Add supply',exact:true}).last().isVisible());
  }
  await page.locator('[data-bloom-dialog-close]').click();assert.equal(await page.getByRole('dialog').count(),0);
  console.log(`PASS ${width}: missing setup padding, visible heading, close clearance, owner/admin layouts`);await page.close();
 }
 for(const width of [375,393,1440]){
 const page=await browser.newPage({viewport:{width,height:844}});let submitted;let key;let attempts=0;
 const rooms=[{id:'kitchen',type:'kitchen',label:'Kitchen',requiredPhoto:true},{id:'living',type:'living_room',label:'Living room',requiredPhoto:true}];
 await page.route('**/api/**',async route=>{if(route.request().method()==='POST'){attempts++;submitted=route.request().postDataJSON();if(!key){key=route.request().headers()['idempotency-key'];await route.abort();return;}assert.equal(key,route.request().headers()['idempotency-key']);await route.fulfill({json:{data:submitted}});}else await route.fulfill({json:{data:{version:1,rooms,supplies:[]}}});});
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('button',{name:'Add supply',exact:true}).click();
 await page.getByLabel('Supply 1',{exact:true}).fill('Dish soap');
 await page.getByRole('button',{name:'Save supplies',exact:true}).click();
 await page.getByRole('button',{name:'Retry saving configuration',exact:true}).click();
 await page.waitForFunction(()=>window.saved===true);
 assert.deepEqual(submitted.rooms,rooms);assert.equal(submitted.supplies[0].name,'Dish soap');assert.equal(attempts,2);
 assert.equal(await page.getByRole('dialog').count(),0);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 console.log(`PASS ${width}: empty grid Add dialog, save supplies preserving rooms, same-key network retry, closes on success, no overflow`);await page.close();
}}finally{await browser.close();await new Promise(r=>server.close(r));}
