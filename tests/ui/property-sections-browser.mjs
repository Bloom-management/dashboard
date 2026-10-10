// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-property-sections';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OwnerListings} from './src/components/bloom/owner-listings';import './src/styles/bloom-application.css';import './src/styles/bloom-owner.css';const listing={id:'unit',name:'Test unit',timezone:'America/Detroit',active:true,nightlyGuestRateCents:null,sources:[],supplies:[],maintenance:[]};createRoot(document.getElementById('root')).render(<div className="bloom-owner"><OwnerListings admin={location.search.includes('admin')} listings={[listing]} integration={{}} onChanged={()=>{}} from="2026-10-01" toExclusive="2026-11-01" revision={0} renderSettings={()=><p>Property configuration</p>}/></div>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=calendar');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const width of [375,393,1440]){
  const page=await browser.newPage({viewport:{width,height:1000}});page.on('pageerror',e=>console.log('PAGE ERROR',e.message));let management='bloom',status='accepted';const removals=[];
  await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;let data=[];
   if(path.endsWith('/remove-assignment')){removals.push(route.request().postDataJSON());data={};}
   else if(path.endsWith('/cleaning-team/jobs')&&page.url().includes('admin'))data=[{id:'job',version:3,checkoutDate:'2026-10-10',management:'bloom',activeCleanerCount:1,capacity:2,assignments:[{id:'assignment',name:'Admin cleaner',cleanerId:'admin'}]}];
   else if(path.endsWith('/cleaning-team'))data={propertyId:'unit',management,requestStatus:status,capacity:2,totalCents:9000,members:[{id:'c',name:'Test cleaner',defaultAssigned:true,individualAmountCents:null}],invitations:[]};
   else if(path.endsWith('/calendar-export'))data={enabled:false};
   else if(path.endsWith('/people'))data={members:[],invitations:[],bloomOwned:false};
   else if(path.includes('performance')){await route.fulfill({status:503,json:{error:{code:'SOURCE_UNAVAILABLE',message:'Fixture unavailable'}}});return;}
   await route.fulfill({json:{data}});
  });
  const base=`http://127.0.0.1:${server.address().port}`;await page.goto(base);
  await page.getByRole('button',{name:'Cleaning team',exact:true}).click();
  await page.getByText('Bloom Cleaning manages new cleanings.',{exact:true}).waitFor();
  assert.equal(await page.getByText('Default assignees',{exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Send cleaner invitation'}).count(),0);
  await page.getByRole('button',{name:'Coverage',exact:true}).click();await page.getByText('No upcoming cleanings.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Send cleaner invitation'}).count(),0);
  management='private';status='pending';await page.getByRole('button',{name:'Cleaning team',exact:true}).click();
  await page.getByRole('button',{name:'Send cleaner invitation'}).waitFor();assert(await page.getByText('Default assignees',{exact:true}).isVisible());
  await page.getByRole('button',{name:'Calendars',exact:true}).click();await page.getByRole('heading',{name:'Connected calendars'}).waitFor();
  assert(await page.getByRole('heading',{name:'Share Bloom availability'}).isVisible());
  assert.equal(await page.getByRole('button',{name:'Connect Airbnb calendar'}).isVisible(),false);
  await page.getByText('Add a calendar connection',{exact:true}).click();assert(await page.getByRole('button',{name:'Connect Airbnb calendar'}).isVisible());
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  management='bloom';status='accepted';await page.goto(base+'?admin');await page.getByRole('button',{name:'Cleaning team',exact:true}).click();await page.getByRole('button',{name:'Send cleaner invitation'}).waitFor();
  await page.getByRole('button',{name:'Coverage',exact:true}).click();await page.getByRole('combobox',{name:/Assigned cleaner/}).selectOption('assignment');assert(await page.getByRole('button',{name:'Remove cleaner',exact:true}).isDisabled());await page.getByLabel('Reason for removal').fill('Unavailable');await page.getByRole('button',{name:'Remove cleaner',exact:true}).click();await page.waitForTimeout(200);assert.deepEqual(removals,[{assignmentId:'assignment',reason:'Unavailable',expectedVersion:3}]);
  console.log(`PASS ${width}: Bloom owner controls hidden, pending private controls retained, admin controls retained, separate coverage/calendars, collapsed setup, no horizontal overflow`);await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
