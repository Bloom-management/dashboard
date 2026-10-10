// Browser interaction tests with mocked transport; PostgreSQL acceptance lives in
// tests/integration/cleaning-handoff.sql. No real notifications are sent here.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT??'/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-handoff-browser';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{CleaningHandoff}from'./src/components/bloom/cleaning-handoff';import './src/styles/bloom-application.css';function App(){const[draft,setDraft]=useState({step:'photos',answers:{},notes:'My unsent notes',version:1,maintenance:{},guestReview:{rating:4.5,comment:'Tidy'},reviewed:[]});const[busy,setBusy]=useState(false);return <main className="bloom-cleaner"><label>Notes<textarea value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label><CleaningHandoff jobId="test-job" userId={new URLSearchParams(location.search).get('user')} configVersion={1} hasTeammate started disabled={busy} draft={draft} setDraft={setDraft} onBusy={setBusy}/><output>{draft.handoffRevision??0}</output></main>}createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:out+'/app.js',platform:'browser',format:'esm',jsx:'automatic',external:['/fonts/*'],plugins:[{name:'stubs',setup(b){b.onResolve({filter:/^next\/(navigation|link)$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from'react';export default p=>React.createElement('a',p);export const useRouter=()=>({});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams();",resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(out+req.url));}else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
let shared={revision:0,draft:null,senderId:null,senderName:null,missing:[]},firstKey,notices=0;
try{
 const sender=await browser.newPage({viewport:{width:390,height:844}});sender.on('pageerror',error=>console.error(error.message));
 await sender.route('**/api/jobs/test-job/handoff',async route=>{
  if(route.request().method()==='POST'){
   const key=route.request().headers()['idempotency-key'];
   if(!firstKey){firstKey=key;const body=route.request().postDataJSON();assert.equal(body.revision,0);assert.equal(body.draft.guestReview.rating,4.5);shared={revision:1,draft:body.draft,senderId:'first',senderName:'First cleaner',missing:['Photo: Kitchen','Supplies check','Maintenance check']};notices++;await route.abort();return;}
   assert.equal(key,firstKey,'Retries must preserve the key');
  }
  await route.fulfill({json:{data:shared}});
 });
 await sender.goto(`http://127.0.0.1:${server.address().port}/?user=first`);
 await sender.getByLabel('Notes').fill('Kitchen counters done; towels in dryer.');
 await sender.getByRole('button',{name:'Ask teammate to finish',exact:true}).click();
 await sender.getByRole('button',{name:'Retry teammate request',exact:true}).click();
 await sender.getByText('Progress saved. Your teammate has been asked to finish.',{exact:true}).waitFor();assert.equal(notices,1);
 const receiver=await browser.newPage({viewport:{width:390,height:844}});
 await receiver.route('**/api/jobs/test-job/handoff',route=>route.fulfill({json:{data:shared}}));
 await receiver.goto(`http://127.0.0.1:${server.address().port}/?user=second`);
 await receiver.getByText('Photo: Kitchen',{exact:true}).waitFor();assert.equal(await receiver.getByLabel('Notes').inputValue(),'My unsent notes','Do not silently replace local work');
 await receiver.getByRole('button',{name:'Use shared progress',exact:true}).click();assert.equal(await receiver.getByLabel('Notes').inputValue(),'Kitchen counters done; towels in dryer.');assert.equal(await receiver.locator('output').textContent(),'1');
 await receiver.getByRole('button',{name:'Restore my previous draft',exact:true}).click();assert.equal(await receiver.getByLabel('Notes').inputValue(),'My unsent notes');
 await receiver.getByRole('button',{name:'Use shared progress',exact:true}).click();assert(await receiver.locator('body').evaluate(el=>el.scrollWidth<=innerWidth));
 console.log('PASS mobile handoff: saved notes/half stars, missing checklist, explicit load/restore, stable retry key, no overflow');
}finally{await browser.close();await new Promise(r=>server.close(r));}
