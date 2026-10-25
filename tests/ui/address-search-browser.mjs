// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-address-visual';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {AddressSearch} from './src/components/bloom/address-search';import './src/styles/bloom-owner.css';function App(){const [value,setValue]=useState(''),[address,setAddress]=useState(null);return <main className="bloom-owner" style={{padding:20}}><AddressSearch value={value} onChange={setValue} onSelect={setAddress} disabled={false}/><output>{address?address.cityId+' '+address.timezone:'unselected'}</output></main>}createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-only-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=people');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});

try {for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}});
 await page.route('**/api/**',async route=>{await route.fulfill({json:{data:route.request().method()==='GET'?[{label:'123 Main St, Los Angeles, CA',city:'Los Angeles, California, United States',timezone:'America/Los_Angeles',token:'fixture'}]:{address:'123 Main St, Los Angeles, CA',cityId:'la',city:'Los Angeles, California, United States',timezone:'America/Los_Angeles',latitude:34,longitude:-118}}});});
 await page.goto('http://localhost:'+server.address().port);
 await page.getByLabel('Street address').fill('123 Main');
 await page.getByRole('button',{name:'123 Main St, Los Angeles, CA',exact:true}).click();
 await page.getByText('Local timezone: America/Los Angeles',{exact:true}).waitFor();
 assert.equal(await page.locator('output').textContent(),'la America/Los_Angeles');
 await page.getByLabel('Street address').fill('456 Changed');
 assert.equal(await page.locator('output').textContent(),'unselected');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 console.log('PASS address selection sets city/timezone and editing invalidates selection: '+width);
 await page.close();
}}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
