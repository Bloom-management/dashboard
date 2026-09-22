// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-day-dialog-visual';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {CleanerHub} from './src/components/bloom/cleaner';import {AdminPricingInbox} from './src/components/bloom/admin-pricing';import './src/styles/bloom-cleaner.css';import './src/styles/bloom-application.css';createRoot(document.getElementById('root')).render(<div className="bloom-cleaner app"><div style={{display:'flex',justifyContent:'flex-end',padding:16}}><AdminPricingInbox/></div><CleanerHub integration={{listCities:async()=>[{id:'city',name:'Detroit',active:true}],getMyCityRequest:async()=>null}}/></div>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-only-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=people');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:850}});let inboxCalls=0;
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Detroit'});
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let data;
   if(path==='/api/admin/pricing'){inboxCalls++;if(inboxCalls>1)await new Promise(resolve=>setTimeout(resolve,500));data=Array.from({length:20},(_,i)=>({id:String(i),name:'Property '+i}));}
   else if(path==='/api/me')data={id:'cleaner',role:'cleaner',displayName:'Cleaner',approvedCityId:'city'};
   else if(path==='/api/jobs')data=Array.from({length:12},(_,i)=>({id:'job-'+i,propertyId:'property-'+i,propertyName:'Full property name '+i,cityId:'city',checkoutDate:today,startAt:today+'T15:00:00Z',endAt:today+'T19:00:00Z',timezone:'America/Detroit',status:'open',activeCleanerCount:0,myAssignmentId:null,changes:[],reviewRequired:false,soloRateCents:7500,sharedRateCents:3750}));
   else throw new Error('Unexpected API '+path);
   return route.fulfill({json:{data}});
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  const bell=page.getByRole('button',{name:'Notifications, 20 need attention'});await bell.waitFor();await bell.click();
  const popup=page.locator('.admin-pricing-inbox');await popup.getByText('Property 0 needs cleaner pricing set').waitFor();
  await page.waitForTimeout(80);assert.equal(await popup.getByText('Property 0 needs cleaner pricing set').count(),1);
  assert.equal(await popup.getByText(/Loading/).count(),0);
  await page.waitForTimeout(600);const box=await popup.boundingBox();assert(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=850);
  assert(await popup.evaluate(el=>el.scrollHeight>el.clientHeight));await page.keyboard.press('Escape');
  await page.locator('.month-btn').click();await page.locator('.month-menu').locator('button').filter({hasText:new RegExp('^'+Number(today.slice(-2))+'$')}).click();
  await page.getByRole('dialog').waitFor();assert.equal(await page.getByRole('dialog').locator('li').count(),12);await page.keyboard.press('Escape');
  await page.locator('.cleaner-city-trigger').click();const cityDialog=page.getByRole('dialog');await cityDialog.getByText('No alternative locations available right now.').waitFor();assert.equal(await cityDialog.getByRole('button',{name:'Request change',exact:true}).count(),0);await page.keyboard.press('Escape');
  const day=page.getByRole('button',{name:'View jobs for '+today,exact:true});await day.focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog');await dialog.waitFor();const closePlacement=await dialog.evaluate(el=>{const box=el.getBoundingClientRect(),close=el.querySelector('[data-bloom-dialog-close]').getBoundingClientRect();return {top:close.top-box.top,right:box.right-close.right};});assert(Math.abs(closePlacement.top-17)<3&&Math.abs(closePlacement.right-17)<3);assert.equal(await dialog.locator('li').count(),12);
  const style=await dialog.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,backdrop:getComputedStyle(el,'::backdrop').backgroundColor,blur:getComputedStyle(el,'::backdrop').backdropFilter}));assert.equal(style.bg,'rgb(255, 255, 255)');assert.equal(style.backdrop,'rgba(0, 0, 0, 0)');assert.equal(style.blur,'none');
  const bounds=await dialog.boundingBox();assert(bounds.width<=width&&bounds.height<=850);await dialog.getByText('Full property name 11',{exact:true}).scrollIntoViewIfNeeded();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await page.waitForFunction(date=>document.activeElement?.getAttribute('data-calendar-date')===date,today);
  await page.getByRole('button',{name:/^Full property name 0,/}).click();await dialog.waitFor();assert.equal(await dialog.locator('li').count(),12);await page.keyboard.press('Escape');
  console.log('PASS '+width+': first-open notifications stay populated and within viewport; day dialog shows 12 full jobs, white surface, transparent backdrop, keyboard close and focus return.');
  await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
