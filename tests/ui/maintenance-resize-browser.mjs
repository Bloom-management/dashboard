// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-maintenance-resize-visual';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MaintenanceCheck} from './src/components/bloom/maintenance';import './src/styles/bloom-cleaner.css';import './src/styles/bloom-application.css';function App(){const [answers,setAnswers]=useState({});return <main className="bloom-cleaner" style={{padding:20,maxWidth:1100,margin:'auto'}}><MaintenanceCheck answers={answers} onChange={setAnswers} disabled={false}/></main>}createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-only-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=people');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.goto('http://127.0.0.1:'+server.address().port);
  const card=category=>page.locator(`[data-category="${category}"]`);
  await card('tv').waitFor();
  await page.waitForTimeout(300);
  const box=await page.locator('.maintenance-workspace').boundingBox();
  const before=await card('tv').boundingBox();
  assert.ok(Math.abs(before.width-before.height)<25,'default cards are square');
  const neighbor=await card('wifi').boundingBox();
  await page.getByRole('button',{name:'TV: Needs attention',exact:true}).click();
  await page.getByLabel('TV issue',{exact:true}).fill('Screen is cracked');
  await page.waitForTimeout(450);
  const after=await card('tv').boundingBox();
  const stable=await page.locator('.maintenance-workspace').boundingBox();
  assert.ok(Math.abs(box.height-stable.height)<2,'canvas stays bounded');
  assert.ok(after.height>before.height,'issue card expands vertically');
  if(width>1000){
   assert.ok(after.width>before.width,'issue card expands horizontally');
   assert.ok((await card('wifi').boundingBox()).height<=neighbor.height+2,'neighbor does not grow taller');
   const boundary=page.getByRole('separator',{name:'Resize maintenance columns'}).first();
   await boundary.focus();await page.keyboard.press('ArrowRight');
   assert.notEqual((await card('tv').boundingBox()).width,after.width,'keyboard resize');
  }
  await page.getByRole('button',{name:'TV: No issue',exact:true}).click();
  assert.equal(await page.getByLabel('TV issue',{exact:true}).count(),0);
  await page.getByRole('button',{name:'TV: Needs attention',exact:true}).click();
  assert.equal(await page.getByLabel('TV issue',{exact:true}).inputValue(),'Screen is cracked');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.getByRole('button',{name:'TV: Needs attention',exact:true}).click();
  await page.waitForTimeout(450);
  assert.equal(await page.getByRole('button',{name:'TV: Needs attention',exact:true}).getAttribute('aria-pressed'),'false');
  assert.ok(Math.abs((await card('tv').boundingBox()).height-before.height)<2);
  await page.getByRole('button',{name:'TV: No issue',exact:true}).click();
  await page.getByRole('button',{name:'TV: No issue',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'TV: No issue',exact:true}).getAttribute('aria-pressed'),'false');
  assert.equal(await page.getByRole('button',{name:/Not applicable/}).count(),0);
  await page.screenshot({path:out+'/'+width+'.png',fullPage:true});
  console.log('PASS maintenance '+width+': square default, bounded expansion, independent heights, saved note, no overflow');
  await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
