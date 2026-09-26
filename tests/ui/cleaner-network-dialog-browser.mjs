// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-network-settings-visual';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {CleanerHub} from './src/components/bloom/cleaner';import {Toaster} from './src/components/ui/toast';import './src/styles/bloom-cleaner.css';import './src/styles/bloom-application.css';createRoot(document.getElementById('root')).render(<><Toaster/><CleanerHub integration={{listCities:async()=>[{id:'city',name:'Detroit',active:true}]}}/></>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=calendar');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:1100}});let enabled=false,dismissed=false,fail=false;
  await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;const post=route.request().method()==='POST';let data=[];
   if(path==='/api/me')data={id:'cleaner',role:'cleaner',displayName:'Cleaner',approvedCityId:width===390&&!enabled?null:'city',bloomNetworkEnabled:enabled};
   if(path==='/api/cities')data=[{id:'city',name:'Detroit',active:true},{id:'other',name:'Chicago',active:true}];
   if(path==='/api/push/settings')data={verified:false,pending:false,newJobs:false,reminders:false,configured:false,appId:null};
   if(path==='/api/notifications'){if(post)dismissed=true;data={items:dismissed?[]:[{id:'network:opportunities',body:'Receive opportunities from Bloom alongside your private cleanings.',href:'/cleaner?network=1',dismissible:true}],total:dismissed?0:1};}
   if(path==='/api/cleaner/network'&&post){if(fail)return route.fulfill({status:503,json:{error:{code:'SERVICE_UNAVAILABLE',message:'Retry'}}});enabled=route.request().postDataJSON().enabled;data={};}
   return route.fulfill({json:{data}});
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  const trigger=page.getByRole('switch',{name:'Bloom opportunities',exact:true});await trigger.waitFor();
  await trigger.click();assert.equal(await page.locator('dialog').count(),0);
  if(width===390){await page.getByRole('radio',{name:'Detroit',exact:true}).check();await page.getByRole('button',{name:'Join Bloom’s cleaner network'}).click();}
  await page.getByText('Bloom opportunities enabled',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.bloom-network-trigger')?.getAttribute('aria-checked')==='true');
  assert.equal(await page.locator('.bloom-toast').last().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
  assert.equal(await page.locator('.bloom-toast').last().evaluate(el=>getComputedStyle(el).fontFamily.includes('Plus Jakarta Sans')),true);
  fail=true;await trigger.click();await page.getByText('Couldn’t save your preference',{exact:true}).waitFor();assert.equal(await trigger.getAttribute('aria-checked'),'true');fail=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByText('Bloom opportunities turned off',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.bloom-network-trigger')?.getAttribute('aria-checked')==='false');
  await page.getByRole('button',{name:'Dismiss notification',exact:true}).first().click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.screenshot({path:`${out}/network-${width}.png`,fullPage:true});console.log(`PASS ${width}: direct toggle, city toast, saved preference, white Bloom toast and dismissal`);await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
