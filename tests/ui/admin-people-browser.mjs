// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-admin-people-visual';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {AdminHub} from './src/components/bloom/admin';import {request} from './src/components/bloom/api';import './src/styles/bloom-cleaner.css';import './src/styles/bloom-application.css';const empty=async()=>({items:[],nextCursor:null});createRoot(document.getElementById('root')).render(<AdminHub integration={{listCities:async()=>[],admin:{properties:empty,users:async()=>({items:[{id:'admin',role:'admin',displayName:'Current admin',email:'admin@example.com'},{id:'owner',role:'owner',displayName:'Test owner',email:'owner@example.com',location:'Detroit'}],nextCursor:null}),cityRequests:empty,sources:empty,propertySources:empty,property:async id=>({id,name:'Test property',timezone:'UTC',active:true,isBloomOwned:true,ownerIds:[],address:'Test',instructions:'Test instructions',soloRateCents:5000})}}}/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-only-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=people');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});let calls=0,key;
  await page.route('**/api/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;
   if(path==='/api/me')return route.fulfill({json:{data:{id:'admin',role:'admin',displayName:'Admin'}}});
   if(path==='/api/admin/users/owner/role'){assert.deepEqual(req.postDataJSON(),{role:'cleaner'});return route.fulfill({json:{data:{}}});}
   assert.equal(path,'/api/admin/invitations');
   assert.deepEqual(req.postDataJSON(),{email:'test@example.com',role:'admin'});
   calls++;
   if(calls===1){key=req.headers()['idempotency-key'];return route.fulfill({status:502,json:{error:{code:'SOURCE_UNAVAILABLE'}}});}
   assert.equal(req.headers()['idempotency-key'],key);
   return route.fulfill({json:{data:{status:'pending'}}});
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('columnheader',{name:'Email',exact:true}).waitFor();
  await page.getByRole('columnheader',{name:'Location',exact:true}).waitFor();
  await page.getByRole('cell',{name:'Detroit',exact:true}).waitFor();
  await page.getByRole('cell',{name:'owner@example.com',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Role for Current admin').isDisabled(),true);
  await page.getByLabel('Role for Test owner').selectOption('cleaner');
  await page.getByLabel('Role for Test owner').waitFor();
  await page.getByLabel('Email address',{exact:true}).fill('test@example.com');
  await page.getByLabel('Invitation role',{exact:true}).selectOption('admin');
  await page.getByRole('button',{name:'Send invite',exact:true}).click();
  await page.getByRole('alert').waitFor();
  await page.getByRole('button',{name:'Send invite',exact:true}).click();
  await page.getByText('Invitation sent to test@example.com as admin.').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  console.log('PASS People '+width+': email, role, failure/retry receipt, confirmed status, no overflow');
  await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
