// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-calendar-save-visual';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OwnerSources} from './src/components/bloom/owner-sources';import './src/styles/bloom-cleaner.css';import './src/styles/bloom-application.css';import './src/styles/bloom-owner.css';createRoot(document.getElementById('root')).render(<OwnerSources listing={{id:'test',name:'Test property',timezone:'America/Detroit',sources:[]}} onChanged={()=>{window.changed=(window.changed||0)+1}}/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-only-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=people');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const status of ['success','failed','partial']){
  const page=await browser.newPage({viewport:{width:390,height:900}});let calls=0;
  await page.route('**/api/**',async route=>{calls++;assert.equal(route.request().method(),'POST');await new Promise(resolve=>setTimeout(resolve,150));return route.fulfill({json:{data:{id:'saved-source',sync:status==='failed'?{status,message:'The source timed out. Retry the sync.'}:{status,runId:'run',created:2,updated:0,removed:0,unchanged:0,conflicts:0}}}});});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByLabel('Private Airbnb iCal export link').fill('https://www.airbnb.com/calendar/ical/test.ics?t=synthetic');
  await page.getByRole('button',{name:'Connect Airbnb calendar',exact:true}).click();
  await page.getByRole('status').filter({hasText:status==='success'?'import completed':status==='failed'?'Import did not complete':'export was incomplete'}).waitFor();
  assert.equal(calls,1);assert.equal(await page.getByLabel('Private Airbnb iCal export link').inputValue(),'');
  assert.equal(await page.evaluate(()=>window.changed),1);
  if(status!=='success')assert.equal(await page.getByText(/import completed/).count(),0);
  console.log('PASS mocked calendar-save UI: '+status+' accurately reported; saved source refreshes; no duplicate request');
  await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
