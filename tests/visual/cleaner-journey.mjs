/** Actual React components in Chromium; intercepted ISOLATED fixtures, NOT backend acceptance.
 * npm install --prefix /tmp/bloom-journey-browser-tools playwright --ignore-scripts
 * node tests/visual/cleaner-journey.mjs
 */
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-journey-visual';await mkdir(out,{recursive:true});
await build({entryPoints:['tests/visual/cleaner-journey-entry.tsx'],bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-only-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams();",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const [width,height,role='cleaner'] of [[402,714],[390,844],[1440,1000],[402,714,'admin']]){
  const page=await browser.newPage({viewport:{width,height}});let started=false;let completeAttempts=[];
  const now=Date.now();let job={id:'test-job',propertyId:'test-property',propertyName:'ISOLATED TEST — Lake House',cityId:'test-city',checkoutDate:new Date(now).toISOString().slice(0,10),startAt:new Date(now-3600000).toISOString(),endAt:new Date(now+3600000).toISOString(),timezone:'America/Detroit',status:'open',reviewRequired:false,version:1,soloRateCents:7500,sharedRateCents:3750,activeCleanerCount:1,myAssignmentId:'test-assignment',myCompletedPayCents:null,changes:[]};
  const rooms=['bedrooms','bedrooms','bathrooms','bathrooms','kitchen','living_room'].map((type,i)=>({id:`room-${i}`,type,label:`${type} ${i+1}`,requiredPhoto:true}));
  const config={version:1,rooms,supplies:[{id:'soap',name:'Isolated soap'}]};
  const receipt={jobId:job.id,eventId:'test-event',completedAt:new Date().toISOString(),completedBy:'test-cleaner',notes:'',reports:[{supplyId:'soap',name:'Isolated soap',level:'low'}]};
  await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;let data;
    if(path.endsWith('/supplies'))data={supplies:config.supplies,reports:[]};
    else if(path.endsWith('/claim'))data=job;
    else if(path.endsWith('/withdraw')){job={...job,myAssignmentId:null,activeCleanerCount:0};data=job;}
    else if(path.endsWith('/start')){started=true;data={job,config,startedAt:new Date().toISOString(),previousReports:[],receipt:null};}
    else if(path.endsWith('/journey'))data={job,config,startedAt:started?new Date().toISOString():null,previousReports:[],receipt:job.status==='completed'?receipt:null};
    else if(path.endsWith('/finalize'))data={id:'test-upload',jobId:job.id,uploaderId:'test-cleaner',category:'bedrooms',roomId:'room-0',state:'ready',createdAt:new Date().toISOString()};
    else if(path.endsWith('/photos'))data=rooms.map((r,i)=>({id:`photo-${i}`,jobId:job.id,uploaderId:i%2?'test-other':'test-cleaner',uploaderName:i%2?'Test teammate':'Test cleaner',category:r.type,roomId:r.id,state:'ready',createdAt:new Date().toISOString()}));
    else if(path.endsWith('/complete')){completeAttempts.push({key:route.request().headers()['idempotency-key'],body:route.request().postData()});if(completeAttempts.length===1){await route.abort('failed');return;}job={...job,status:'completed',myCompletedPayCents:7500};data={job,receipt};}
    else throw new Error(`Unexpected fixture request ${path}`);
    await route.fulfill({json:{data}});
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}?role=${role}`);
  await page.getByRole('button',{name:'Claim this cleaning',exact:true}).click();
  await page.getByRole('button',{name:'Start cleaning →',exact:true}).click();
  await page.getByRole('button',{name:'Start cleaning →',exact:true}).click();
  assert.equal(completeAttempts.length,0,'Opening the checklist must not submit completion');
  await page.getByRole('button',{name:'Job details and rates',exact:true}).click();
  await page.getByRole('dialog',{name:'Job details and rates',exact:true}).waitFor();
  const details=page.getByRole('dialog',{name:'Job details and rates',exact:true});
  assert.equal(await details.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'job details fit viewport');
  await details.screenshot({path:`${out}/details-${width}.png`});
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(),1,'Escape closes only job details');
  assert.equal(await page.getByText('Cleaning as yourself',{exact:false}).count(),role==='admin'?1:0);
  await page.locator('input[type=file]').first().setInputFiles({name:'isolated.png',mimeType:'image/png',buffer:Buffer.from('isolated component fixture; backend byte validation tested separately')});
  await page.getByText('Upload failed',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await page.getByText('Photo saved',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Continue to supplies →',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Continue to maintenance →',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Low',exact:true}).click();
  await page.getByRole('button',{name:'Review photos',exact:true}).click();
  await page.getByRole('button',{name:'Continue to supplies →',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Low',exact:true}).getAttribute('aria-pressed'),'true');
  const overflow=await page.locator('dialog').evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(overflow,false,`horizontal overflow at ${width}`);
  assert.ok(await page.locator('dialog section').first().evaluate(el=>el.getBoundingClientRect().width) > (width>1000?500:280), 'task panel remains readable');
  await page.locator('dialog').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:`${out}/supplies-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Continue to maintenance →',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Complete cleaning',exact:true}).isDisabled(),true);
  for(const button of await page.getByRole('button',{name:'No issue',exact:true}).all())await button.click();
  const chosen=await page.locator('.maintenance-options button[aria-pressed=true]').first().evaluate(el=>getComputedStyle(el).backgroundColor);
  const unchosen=await page.locator('.maintenance-options button[aria-pressed=false]').first().evaluate(el=>getComputedStyle(el).backgroundColor);assert.notEqual(chosen,unchosen,'maintenance selection is visibly distinct');
  await page.locator('textarea').fill('Isolated note');
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.getByRole('button',{name:'Continue to maintenance →',exact:true}).click();
  assert.equal(await page.locator('textarea').inputValue(),'Isolated note');
  await page.getByRole('button',{name:'Complete cleaning',exact:true}).click();
  await page.getByRole('button',{name:'Retry completion',exact:true}).waitFor();
  assert.equal(await page.locator('textarea').isDisabled(),true);
  await page.reload();
  await page.getByRole('button',{name:'Retry completion',exact:true}).click();
  await page.getByRole('heading',{name:'Cleaning complete.',exact:true}).waitFor();
  assert.deepEqual(completeAttempts[0],completeAttempts[1]);
  assert.equal(await page.getByText('Cleaning as yourself',{exact:false}).count(),0);
  assert.deepEqual(errors,[]);console.log(`PASS ${width}x${height}: claim/start/end, room step, supplies/maintenance/back, lost response + reload retry, no horizontal overflow`);started=false;job={...job,status:'open',myAssignmentId:'test-assignment',activeCleanerCount:1,startAt:new Date(Date.now()+86400000).toISOString(),endAt:new Date(Date.now()+100800000).toISOString()};
  await page.goto(`http://127.0.0.1:${server.address().port}?withdraw=1&role=${role}`);
  await page.getByRole('button',{name:'Claim this cleaning',exact:true}).click();
  await page.getByRole('button',{name:'Withdraw from cleaning',exact:true}).click();
  await page.getByRole('button',{name:'Claim this cleaning',exact:true}).waitFor({state:'visible'});
  await page.locator('dialog').waitFor({state:'detached'});
  console.log(`PASS ${width}: withdraw returns to original card then closes`);
  if(width<=600){
    await page.goto(`http://127.0.0.1:${server.address().port}?calendar=1`);
    const sizes=await page.locator('td > div').evaluateAll(elements=>elements.map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));
    assert.ok(sizes.length>0&&sizes.every(size=>Math.abs(size.width-size.height)<2),'mobile calendar cells are square');
    await page.screenshot({path:`${out}/calendar-${width}.png`});
  }
  await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
