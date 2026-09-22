// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-rail-overflow';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {PropertyRail} from './src/components/bloom/primitives';import './src/styles/bloom-cleaner.css';import './src/styles/bloom-application.css';function App(){const[selected,setSelected]=useState('');return <main className="bloom-cleaner cleaner-hub"><PropertyRail properties={Array.from({length:9},(_,i)=>({id:String(i),name:'Unit '+i}))} selected={selected} onSelect={setSelected}/><output>{selected}</output></main>}createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-only-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=people');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const width of [320,390,1440]){
  const page=await browser.newPage({viewport:{width,height:850}});await page.goto('http://127.0.0.1:'+server.address().port);
  assert.equal(await page.locator('.rail-item').count(),6);assert.equal(await page.locator('.rail-more').textContent(),'+5');
  const last=await page.locator('.rail-item').nth(4).boundingBox(),more=await page.locator('.rail-more').boundingBox();assert(width<=760?more.x>last.x:more.y>last.y);
  await page.locator('.rail-more').click();const dialog=page.getByRole('dialog');await dialog.waitFor();assert.equal(await dialog.locator('li').count(),10);await dialog.getByRole('button',{name:'Unit 8',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(await page.locator('output').textContent(),'8');assert(await page.locator('.rail-more').evaluate(el=>el.classList.contains('active')));
  console.log('PASS '+width+': four listings plus overflow; all units selectable.');await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
