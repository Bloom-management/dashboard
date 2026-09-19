// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-owner-visual';await mkdir(out,{recursive:true});
await build({entryPoints:['tests/ui/owner-browser-entry.tsx'],bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-only-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams();",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
 for(const role of ['owner','admin']) for(const width of [390,1440]) {
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const month=new Date().toISOString().slice(0,7);const properties=[{id:'unit-a',name:'ISOLATED · Lake unit',cityId:'city-a',cityName:'Detroit'},{id:'unit-b',name:'ISOLATED · Empty unit',cityId:'city-b',cityName:'Chicago'}];
  const block={id:'stay-a',propertyId:'unit-a',propertyName:properties[0].name,timezone:'America/Detroit',startDate:`${month}-02`,endDate:`${month}-06`,providers:['airbnb'],kind:'reservation',removed:false,changes:[]};
  const totals={bookedNights:4,blockedNights:2,occupiedNights:6,unbookedNights:null,checkIns:1,occupancy:null,coverage:{status:'unknown',from:`${month}-01`,toExclusive:`${month}-30`,eligibleUnitNights:0,totalUnitNights:29,message:'Calendar coverage is unknown.'},platformShare:[{platform:'airbnb',nights:4,share:2/3},{platform:'vrbo',nights:0,share:0},{platform:'unknown',nights:2,share:1/3}]};
  let saved=false,syncCalls=0;const calls=[];
  const source={id:'source-test',propertyId:'unit-a',provider:'airbnb',enabled:true,lastSuccessAt:null,lastAttemptAt:null,message:null};
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());calls.push(url.pathname+url.search);let data;
   if(url.pathname==='/api/me')data={id:'isolated-owner',role,displayName:'Test account',approvedCityId:null};
   else if(url.pathname==='/api/owner/properties')data=properties;
   else if(url.pathname==='/api/owner/freshness')data=properties.map(p=>({propertyId:p.id,lastSuccessAt:null,message:null}));
   else if(url.pathname==='/api/owner/calendar')data=[block,{...block,id:'blocked-b',providers:['vrbo'],kind:'blocked',startDate:`${month}-04`,endDate:`${month}-08`}];
   else if(url.pathname==='/api/owner/performance')data={from:url.searchParams.get('from'),toExclusive:url.searchParams.get('toExclusive'),totals,properties:properties.map(p=>({...totals,propertyId:p.id,propertyName:p.name})),assumption:'Blocks count occupied.'};
   else if(url.pathname==='/api/owner/listings')data={items:properties.map(p=>({...p,timezone:'America/Detroit',active:true,supplies:[{supplyId:'soap',name:'Test soap',level:null,reportedAt:null},{supplyId:'towels',name:'Test towels',level:'low',reportedAt:'2026-09-18T16:00:00Z'}],nightlyGuestRateCents:null,hostPayoutCents:null,currency:'USD',sources:saved&&p.id==='unit-a'?[source]:[]})),nextCursor:null};
   else if(url.pathname.endsWith('/cleaning-config'))data={version:1,rooms:[{id:'bed-1',type:'bedrooms',label:'',requiredPhoto:true},{id:'bed-2',type:'bedrooms',label:'',requiredPhoto:true},{id:'kitchen',type:'kitchen',label:'Kitchen 1',requiredPhoto:true},{id:'living',type:'living_room',label:'Family lounge',requiredPhoto:true}],supplies:[]};
   else if(url.pathname.endsWith('/calendar-sources')){if(req.method()==='POST'){assert.deepEqual(Object.keys(req.postDataJSON()),['url']);assert.ok(req.headers()['idempotency-key']);saved=true;data=source;}else data={items:saved?[source]:[],nextCursor:null};}
   else if(url.pathname.endsWith('/sync')){syncCalls++;if(syncCalls===1){await route.fulfill({status:502,json:{error:{code:'SOURCE_UNAVAILABLE',message:'Calendar unavailable. Retry sync.'}}});return;}data={status:'success',runId:'test-run',created:2,updated:0,removed:0,unchanged:0,conflicts:0};}
   else throw Error(`Unexpected owner call ${url.pathname}`);
   await route.fulfill({json:{data}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('.owner-month-event').first().waitFor();
  assert.equal(await page.getByText('+ Add listing',{exact:true}).count(),0,'creation action only on Listings');
  assert.equal(await page.getByRole('button',{name:'Remove ISOLATED · Lake unit',exact:true}).count(),1,'selected unit has removable chip');
  await page.getByRole('combobox',{name:'Search and select units'}).click();await page.getByText('Detroit',{exact:true}).waitFor();await page.getByText('Chicago',{exact:true}).waitFor();assert.ok(await page.locator('[data-city-separator]').count()>0);await page.keyboard.press('Escape');
  assert.equal(await page.locator('table tbody tr').count(),6,'shared six-week month grid');
  assert.equal(await page.locator('table tbody tr').first().locator('td').count(),7,'seven weekday columns');
  assert.equal(await page.getByRole('link',{name:'Admin Hub',exact:true}).count(),role==='admin'?1:0);
  assert.equal(await page.getByRole('button',{name:'Show units',exact:true}).count(),0,'selected units show only clear');
  await page.locator('.owner-month-event').first().click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Clear selected units',exact:true}).click();await page.getByText('No units selected',{exact:true}).waitFor();
  await page.getByRole('combobox',{name:'Search and select units'}).fill('Empty');await page.getByRole('option',{name:properties[1].name}).click();await page.keyboard.press('Escape');assert.equal(await page.locator('.owner-month-event').count(),0);
  await page.getByRole('combobox',{name:'Search and select units'}).click();await page.getByRole('button',{name:'Select all units',exact:true}).click();await page.keyboard.press('Escape');await page.locator('.owner-month-event').first().waitFor();
  await page.getByRole('button',{name:'Clear selected units',exact:true}).click();await page.getByText('No units selected',{exact:true}).waitFor();await page.getByRole('combobox',{name:'Search and select units'}).click();await page.getByRole('button',{name:'Select all units',exact:true}).click();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Performance',exact:true}).click();await page.getByText('Calendar coverage is unknown.',{exact:false}).waitFor();assert.ok(await page.getByText('N/A',{exact:true}).count()>=2);
  await page.getByRole('button',{name:'Next property performance'}).click();await page.getByRole('heading',{name:properties[0].name,exact:true}).waitFor();
  await page.getByRole('button',{name:'Next property performance'}).click();await page.getByRole('heading',{name:properties[1].name,exact:true}).waitFor();
  await page.getByRole('button',{name:'Previous property performance'}).click();await page.getByRole('heading',{name:properties[0].name,exact:true}).waitFor();
  assert.equal(await page.locator('section[aria-label="Property performance"] select').count(),4,'two months with month/year selectors');
  assert.equal(await page.locator('section[aria-label="Property performance"] input[type=date]').count(),0);
  const panels=page.locator('.owner-independent-range > *');const leftBounds=await panels.nth(0).boundingBox();const rightBounds=await panels.nth(1).boundingBox();if(width>650){assert.ok(Math.abs(leftBounds.y-rightBounds.y)<2,'range months stay side by side');}else{assert.equal(rightBounds,null,'end calendar hidden on phone');await page.getByRole('button',{name:'End',exact:true}).click();assert.equal(await panels.nth(0).isVisible(),false);assert.equal(await panels.nth(1).isVisible(),true);await page.getByRole('button',{name:'Start',exact:true}).click();}
  await page.screenshot({path:`${out}/performance-${width}.png`,fullPage:true});
  const dateSelectors=page.locator('section[aria-label="Property performance"] select');const rightMonth=await dateSelectors.nth(2).inputValue();const rightYear=await dateSelectors.nth(3).inputValue();
  await dateSelectors.nth(0).selectOption({index:6});await dateSelectors.nth(1).selectOption('2024');
  assert.equal(await dateSelectors.nth(2).inputValue(),rightMonth);assert.equal(await dateSelectors.nth(3).inputValue(),rightYear);

  await page.getByRole('button',{name:'Clear dates',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Apply dates',exact:true}).isDisabled(),true);await page.getByText('Select a start date',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Listings',exact:true}).click();assert.equal(await page.getByRole('combobox',{name:'Search and select units'}).count(),0);assert.equal(await page.getByRole('button',{name:'Apply dates',exact:true}).count(),0);assert.equal(await page.getByText('+ Add listing',{exact:true}).count(),1);await page.getByRole('navigation',{name:'Properties',exact:true}).getByRole('button').filter({hasText:properties[0].name}).click();await page.getByRole('button',{name:'Next property section',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Supplies',exact:true}).getAttribute('aria-pressed'),'true');await page.getByText('Not reported yet',{exact:true}).waitFor();await page.getByRole('button',{name:'Next property section',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Maintenance',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await page.getByRole('group',{name:'Maintenance, 3 of 4'}).locator('.owner-supply-card').count(),8);await page.getByRole('button',{name:'Rate',exact:true}).click();await page.getByText(/Airbnb: 66.7%/).waitFor();await page.getByText(/Off-platform \/ unknown:/).waitFor();
  if(width>700){const split=await page.locator('.owner-listings-split').boundingBox();assert.ok(Math.abs(split.y+split.height-900)<4,'columns extend to viewport bottom');const mainOverflow=await page.locator('.owner-listings-main').evaluate(el=>el.scrollHeight-el.clientHeight);assert.ok(mainOverflow<2,'outer listings view does not double-scroll');}
  await page.getByRole('button',{name:'Delete listing',exact:true}).first().click();
  const deleteDialog=page.locator('.property-delete-dialog');
  await deleteDialog.waitFor();
  const dialogBox=await deleteDialog.boundingBox();
  const closeBox=await deleteDialog.getByRole('button',{name:'Close details'}).boundingBox();
  assert.ok(closeBox.x>dialogBox.x+dialogBox.width/2,'delete close is on the right');
  await page.mouse.click(2,2);
  await deleteDialog.waitFor({state:'detached'});
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  const rooms=page.locator('.cleaning-room-carousel');
  await rooms.getByLabel('Room label',{exact:true}).waitFor();
  assert.equal(await rooms.locator('.cleaning-room-slide').count(),1);
  assert.equal(await rooms.getByLabel('Room label',{exact:true}).inputValue(),'Bedroom 1');
  await rooms.getByRole('button',{name:'Next room',exact:true}).click();
  assert.equal(await rooms.getByLabel('Room label',{exact:true}).inputValue(),'Bedroom 2');
  await rooms.getByLabel('Room type',{exact:true}).selectOption('bathrooms');
  assert.equal(await rooms.getByLabel('Room label',{exact:true}).inputValue(),'Bathroom 1');
  await rooms.getByLabel('Room label',{exact:true}).fill('Guest suite');
  await rooms.getByLabel('Room type',{exact:true}).selectOption('bedrooms');
  assert.equal(await rooms.getByLabel('Room label',{exact:true}).inputValue(),'Guest suite');
  await rooms.getByRole('button',{name:'Add actual room',exact:true}).click();
  assert.equal(await rooms.getByLabel('Room label',{exact:true}).inputValue(),'Bedroom 2');
  await rooms.getByRole('button',{name:'Remove room',exact:true}).click();
  assert.equal(await rooms.getByLabel('Room label',{exact:true}).inputValue(),'Family lounge');
  await page.getByRole('button',{name:'Next setup section',exact:true}).click();
  assert.equal(await rooms.isVisible(),false);
  await page.getByRole('button',{name:'Add supply',exact:true}).waitFor();
  await page.getByRole('button',{name:'Next setup section',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Add supply',exact:true}).isVisible(),false);


  await page.getByLabel('Private Airbnb iCal export link',{exact:true}).fill('https://example.invalid/isolated.ics');await page.getByRole('button',{name:'Connect Airbnb calendar'}).click();await page.getByText('Airbnb link saved. Choose Sync now to import its calendar.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Sync now'}).click();await page.getByText('Calendar unavailable. Retry sync.',{exact:true}).waitFor();assert.equal(await page.getByRole('navigation',{name:'Properties',exact:true}).getByRole('button').filter({hasText:properties[0].name}).count(),1);
  await page.getByRole('button',{name:'Sync now'}).click();await page.getByText(/Synced calendar entries: 2 added/).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'no page horizontal overflow');
  assert.deepEqual(errors,[]);await page.locator('.owner-main').evaluate(el=>el.scrollTop=0);await page.screenshot({path:`${out}/listings-${width}.png`,fullPage:true});
  if(role==='owner'){
   let supplyBody, supplyKey, attempts=0;const feeds=[];
   await page.route('**/api/cities',route=>route.fulfill({json:{data:[{id:'city-a',name:'Detroit',active:true}]}}));
   await page.route('**/api/owner/listings',async route=>{
    if(route.request().method()!=='POST')return route.fallback();
    await route.fulfill({json:{data:{listing:{...properties[0],id:'created-unit',supplies:[],sources:[],active:true,timezone:'America/Detroit'}}}});
   });
   await page.route('**/api/owner/properties/created-unit/cleaning-config',async route=>{
    const body=route.request().postDataJSON(),key=route.request().headers()['idempotency-key'];attempts++;
    if(attempts===1){supplyBody=body;supplyKey=key;await route.fulfill({status:503,json:{error:{code:'SOURCE_UNAVAILABLE',message:'Try again'}}});return;}
    assert.deepEqual(body,supplyBody);assert.equal(key,supplyKey);
    await route.fulfill({json:{data:body}});
   });
   await page.route('**/api/owner/properties/created-unit/calendar-sources',async route=>{
    feeds.push(route.request().postDataJSON());await route.fulfill({json:{data:{id:'feed-'+feeds.length}}});
   });
   await page.getByRole('button',{name:'+ Add listing',exact:true}).click();
   const create=page.locator('.owner-create-dialog');
   await create.getByLabel('Listing name',{exact:true}).fill('Supply grid test');
   await create.getByLabel('Address / unit',{exact:true}).fill('Test address');
   await create.getByRole('button',{name:'Supplies',exact:true}).click();
   await create.getByRole('button',{name:'+ Add supply',exact:true}).click();
   await create.getByPlaceholder('e.g. Dish soap').fill('Dish soap');
   await create.getByRole('button',{name:'Calendars',exact:true}).click();
   await create.getByRole('button',{name:'+ Add calendar',exact:true}).click();
   await create.getByRole('button',{name:'Calendars',exact:true}).click();
   await create.getByRole('button',{name:'+ Add calendar',exact:true}).click();
   await create.getByLabel('Private iCal export link',{exact:true}).nth(0).fill('https://www.airbnb.com/calendar/ical/123.ics');
   await create.getByLabel('Private iCal export link',{exact:true}).nth(1).fill('https://www.vrbo.com/icalendar/example.ics');
   await create.getByLabel('Provider',{exact:true}).nth(1).selectOption('vrbo');
   await create.getByRole('button',{name:'Save listing',exact:true}).click();
   await create.getByRole('button',{name:'Retry saving supplies',exact:true}).click();
   await create.getByText('Supplies saved. You can update them later in Settings.').waitFor();
   assert.equal(supplyBody.supplies[0].name,'Dish soap');assert.deepEqual(feeds.map(f=>f.provider),['airbnb','vrbo']);
   await create.getByRole('button',{name:'Close details'}).click();
  }
  await page.getByRole('navigation',{name:'Owner views'}).getByRole('button',{name:'Calendar',exact:true}).click();await page.locator('.owner-main').evaluate(el=>el.scrollTop=0);await page.waitForTimeout(200);await page.screenshot({path:`${out}/calendar-${width}.png`,fullPage:true});
  console.log(`PASS ${role} ${width}: seven-column month grid, event details, empty-unit filter, N/A, supplies, source failure/retry, percentages, mobile overflow`);await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
