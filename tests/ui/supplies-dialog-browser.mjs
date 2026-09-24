// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-supplies-dialog';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {SupplyReferenceGrid} from './src/components/bloom/maintenance';import './src/styles/bloom-application.css';function App(){return <main className="bloom-cleaner"><SupplyReferenceGrid supplies={Array.from({length:11},(_,i)=>({id:String(i),name:'Supply '+i}))}/></main>}createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-only-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=people');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:700}});await page.goto('http://127.0.0.1:'+server.address().port);
  assert.equal(await page.locator('.owner-supply-card').count(),4);
  await page.getByRole('button',{name:'+7 supplies'}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();assert.equal(await dialog.locator('.owner-supply-card').count(),11);
  const box=await dialog.boundingBox();assert(box.x>=0&&box.x+box.width<=width);assert(box.y>=0&&box.y+box.height<=700);
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await page.locator('.owner-supply-card').count(),4);console.log('PASS '+width+': four supplies, overflow count, full supplies dialog and dismissal.');await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
