// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-service-area-visual';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ServiceCities} from './src/components/bloom/service-cities';import './src/styles/bloom-owner.css';import './src/styles/bloom-application.css';createRoot(document.getElementById('root')).render(<main className="bloom-cleaner"><ServiceCities/></main>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-only-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=people');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});

try {for(const hub of ['bloom-cleaner','bloom-owner'])for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}});const cities=[{id:'detroit',name:'Detroit',active:true,cleaning_coverage:'available',properties:1,cleaners:4}];let saved;
 await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;let data;
 if(path==='/api/locations/cities'&&req.method()==='GET')data=[{label:'Chicago, Illinois, United States',token:'signed-fixture',timezone:'America/Chicago'}];
 else if(path==='/api/locations/cities'){data={id:'chicago',name:'Chicago, Illinois, United States',active:true,coverage:'unavailable',timezone:'America/Chicago'};cities.push({...data,cleaning_coverage:'unavailable',properties:0,cleaners:0});}
 else if(req.method()==='POST'){saved=req.postDataJSON();cities.find(city=>city.id===saved.cityId).cleaning_coverage=saved.coverage;data={};}
 else data=cities;
 await route.fulfill({json:{data}});
 });
 await page.goto('http://localhost:'+server.address().port);
 await page.locator('main').evaluate((el,hub)=>el.className=hub,hub);
 await page.getByRole('button',{name:'Add city',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Find a city',exact:true});
 const geometry=await dialog.evaluate(el=>{const d=el.getBoundingClientRect(),h=el.querySelector('h2').getBoundingClientRect();return {radius:parseFloat(getComputedStyle(el).borderRadius),inset:h.left-d.left,width:d.width,overflow:el.scrollWidth>el.clientWidth};});
 assert(geometry.radius>=24,'Shared dialog must retain rounded surface');assert(geometry.inset>=20,'Shared dialog must inset its content');assert(geometry.width<=640,'Shared dialog must use standard width');assert(!geometry.overflow);
 assert.equal(await dialog.getByRole('heading',{name:'Find a city',exact:true}).count(),1);
 await page.getByLabel('City name',{exact:true}).fill('Chicago');await page.getByRole('button',{name:'Chicago Illinois, United States'}).click();assert.equal(await page.getByLabel('Local timezone').count(),0);await page.getByText('Local timezone: America/Chicago').waitFor();await page.getByRole('button',{name:'Use this city',exact:true}).click();
 await page.getByRole('heading',{name:'Chicago, Illinois, United States',exact:true}).waitFor();const coverage=page.getByLabel('Cleaning coverage for Chicago, Illinois, United States',{exact:true});assert.equal(await coverage.inputValue(),'unavailable');await coverage.selectOption('waitlist');await page.waitForFunction(()=>[...document.querySelectorAll('select')].some(el=>el.value==='waitlist'));assert.equal(saved.coverage,'waitlist');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));console.log(`PASS ${hub} ${width}: shared dialog surface, add standardized city, unavailable by default, update coverage, no horizontal overflow`);await page.close();
}}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
