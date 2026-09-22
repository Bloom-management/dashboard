// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-dialog-viewport';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Modal} from './src/components/bloom/primitives';import './src/styles/bloom-application.css';import './src/styles/bloom-owner.css';function App(){const[open,setOpen]=useState(false);return <main className="bloom-owner" style={{minHeight:3000,paddingTop:800}}><button id="open" onClick={()=>setOpen(true)}>View booking</button>{open&&<Modal title="Booking details" className="bk-card" onClose={()=>setOpen(false)}><div className="bk-banner">Calendar feed: Airbnb</div><div className="bk-body"><h2>Test unit</h2>{Array.from({length:30},(_,i)=><p key={i}>Booking information {i}</p>)}</div></Modal>}</main>}createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-only-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=people');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:700}});await page.goto('http://127.0.0.1:'+server.address().port);
  await page.locator('#open').scrollIntoViewIfNeeded();const original=await page.evaluate(()=>scrollY);assert(original>0);
  await page.locator('#open').click();const dialog=page.getByRole('dialog');await dialog.waitFor();await page.waitForTimeout(250);
  async function bounds(){const box=await dialog.boundingBox();const height=await page.evaluate(()=>innerHeight);assert(box.y>=0&&box.y+box.height<=height+1,JSON.stringify(box));assert.equal(await dialog.evaluate(el=>getComputedStyle(el).position),'fixed');}
  await bounds();assert.equal(await page.evaluate(()=>document.body.style.position),'fixed');
  await dialog.hover();await page.mouse.wheel(0,500);await page.waitForTimeout(200);assert(await dialog.evaluate(el=>el.scrollTop)>0);assert.equal(await page.evaluate(()=>scrollY),0);
  await page.setViewportSize({width,height:500});await bounds();
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>document.body.style.position),'');assert.equal(await page.evaluate(()=>scrollY),original);assert.equal(await page.evaluate(()=>document.activeElement.id),'open');
  console.log('PASS '+width+': viewport-bound booking dialog, internal scroll, resized viewport, restored page position and focus.');await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
