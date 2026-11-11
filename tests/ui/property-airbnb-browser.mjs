// Real shared components with an isolated API fixture. SQL authorization is
// independently checked in supabase/tests/property_airbnb.sql.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT??'/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-property-airbnb';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{OwnerListings}from'./src/components/bloom/owner-listings';import{PropertyThumbnailSettings}from'./src/components/bloom/property-thumbnail';import{PropertyRail}from'./src/components/bloom/primitives';import'./src/styles/bloom-cleaner.css';import'./src/styles/bloom-owner.css';import'./src/styles/bloom-application.css';const admin=new URLSearchParams(location.search).get('role')==='admin';const listings=[{id:'unit-a',name:'3628 Trumbull',timezone:'America/Detroit',active:true,nightlyRateCents:12500,supplies:[],sources:[],maintenance:[]}];createRoot(document.getElementById('root')).render(<main className={admin?'bloom-cleaner':'bloom-owner'}><div className="bloom-owner" style={{padding:16}}><h1>{admin?'Admin':'Owner'} Properties</h1><OwnerListings listings={listings} admin={admin} integration={{}} onChanged={()=>{}} from="2026-11-01" toExclusive="2026-12-01" revision={0} renderSettings={listing=><PropertyThumbnailSettings id={listing.id}/>}/></div><PropertyRail properties={listings} selected="unit-a" onSelect={()=>{}}/></main>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:out+'/app.js',platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/owner';export const useSearchParams=()=>new URLSearchParams(location.search);",loader:'js',resolveDir:process.cwd()}));}}]});
const listing='https://www.airbnb.com/rooms/1568588871312234223';
const image='https://a0.muscache.com/im/pictures/hosting/Hosting-1568588871312234223/original/d6cbebb5-dbdd-4fb8-8d1f-5e6594ee591f.jpeg?im_w=720';
let state={listingUrl:null,image:null,status:'none',revision:0,canEdit:true},retryWorks=false;
const server=createServer(async(req,res)=>{try{
 if(req.url.startsWith('/api/')){
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  let data;
  if(req.url.endsWith('/airbnb')){
   if(req.method==='POST'){
    let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);
    assert.equal(input.revision,state.revision);
    const canonical=input.listingUrl?'https://www.airbnb.com'+new URL(input.listingUrl).pathname:null;
    const cover=input.manualImageUrl||(canonical===listing||retryWorks?image:null);
    state={listingUrl:canonical,image:canonical?cover:null,status:!canonical?'none':input.manualImageUrl?'manual':cover?'extracted':'unavailable',revision:state.revision+1,canEdit:true};
   }data=state;
  }else if(req.url.endsWith('/people'))data={members:[],invitations:[],bloomOwned:false};
  else if(req.url.includes('/performance'))data={totals:{platformShare:[],coverage:{status:'unknown'}}};
  else data={};
  res.end(JSON.stringify({data}));
 }else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(out+req.url));}
 else if(req.url.startsWith('/fonts/'))res.end(await readFile('public'+req.url));
 else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script>window.process={env:{NODE_ENV:"development"}}</script><script type="module" src="/app.js"></script>');}
 }catch(e){console.error(e);res.writeHead(500);res.end();}
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const errors=[];
try{
 const context=await browser.newContext();await context.route('https://*.muscache.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480"><rect width="720" height="480" fill="#c98491"/></svg>'}));
 const owner=await context.newPage(),admin=await context.newPage();for(const page of [owner,admin])page.on('pageerror',e=>{errors.push(e.message);console.error('Browser runtime:',e.message);});
 const base='http://127.0.0.1:'+server.address().port;
 await owner.goto(base+'/?role=owner&section=settings');await admin.goto(base+'/?role=admin&section=settings');
 const field=page=>page.getByRole('textbox',{name:'Airbnb listing URL',exact:true});
 const save=page=>page.getByRole('button',{name:'Save Airbnb listing',exact:true}).click();
 await field(owner).fill(listing+'?source_impression_id=tracking');await save(owner);
 await field(admin).waitFor();await admin.waitForFunction(url=>document.querySelector('input[type=url]')?.value===url,listing);
 for(const page of [owner,admin]){await page.locator('.owner-property-cover-heading img').waitFor();assert.equal(await page.locator('.owner-property-cover-heading img').getAttribute('src'),image);assert.equal(await page.locator('.rail-item img').getAttribute('src'),image);}
 console.log('PASS Owner save updates Admin, property cards and calendar side rail across tabs.');
 await field(admin).fill('https://www.airbnb.com/rooms/42?tracking=1');await save(admin);
 await owner.getByText('Listing saved. Airbnb did not provide a cover photo.',{exact:false}).waitFor();
 assert.equal(await owner.locator('.owner-property-cover-heading img').count(),0);assert.equal(await owner.locator('.rail-item img').count(),0);assert.equal(await field(owner).inputValue(),'https://www.airbnb.com/rooms/42');
 await owner.getByText('Use a manual cover image URL',{exact:true}).click();await owner.getByRole('textbox',{name:'Airbnb image URL',exact:true}).fill(image);await save(owner);
 await admin.locator('.owner-property-cover-heading img').waitFor();assert.equal(state.status,'manual');
 await owner.reload();await admin.reload();await field(owner).waitFor();await field(admin).waitFor();
 assert.equal(await field(admin).inputValue(),'https://www.airbnb.com/rooms/42');assert.equal(await admin.getByRole('textbox',{name:'Airbnb image URL',exact:true}).inputValue(),image);
 retryWorks=true;await admin.getByRole('button',{name:'Retry cover extraction',exact:true}).click();await owner.getByRole('textbox',{name:'Airbnb listing URL',exact:true}).waitFor();await owner.waitForFunction(()=>!document.querySelector('details')?.open);
 assert.equal(state.status,'extracted');console.log('PASS Admin replacement clears old photo; manual fallback, refresh persistence and retry work.');
 for(const width of [360,1440])for(const page of [owner,admin]){
  await page.setViewportSize({width,height:900});
  const result=await page.locator('.owner-property-cover-heading img').evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,fit:getComputedStyle(el).objectFit}));
  assert.deepEqual(result,{width:44,height:44,fit:'cover'});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page overflow');
  await page.screenshot({path:out+'/'+(page===owner?'owner':'admin')+'-'+width+'.png'});
 }
 await owner.route('https://*.muscache.com/**',route=>route.abort());
 const failed=owner.waitForEvent('requestfailed',{predicate:req=>req.url().includes('.muscache.com/')});await owner.reload();await failed;
 await owner.locator('.owner-property-cover-heading > span > svg').waitFor();
 assert.equal(await owner.locator('.owner-property-cover-heading img').count(),0);
 await owner.unroute('https://*.muscache.com/**');await owner.getByRole('button',{name:'Retry cover extraction',exact:true}).click();await owner.locator('.owner-property-cover-heading img').waitFor();
 assert.deepEqual(errors,[]);console.log('PASS Owner/Admin mobile and desktop: consistent crop, preserved card layout, no page overflow or runtime errors; broken images show placeholders and can recover.');
 await context.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
