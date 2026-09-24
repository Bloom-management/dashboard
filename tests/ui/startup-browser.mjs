// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-startup';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {StartupBoundary} from './src/components/bloom/startup/startup-boundary';import {RoleGate,ErrorNotice} from './src/components/bloom/primitives';import {useCalendar} from './src/components/bloom/use-calendar';import './src/styles/bloom-application.css';function Data(){const data=useCalendar('fixture','/jobs?from=2030-01-01&to=2030-02-01');return data.error?<ErrorNotice error={data.error} retry={data.reload}/>:<><h1>Ready hub</h1><button onClick={data.reload}>Refresh</button></>}createRoot(document.getElementById('root')).render(<StartupBoundary><RoleGate role="cleaner">{()=> <Data/>}</RoleGate></StartupBoundary>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-only-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation|dynamic)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=people');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const mode of ['browser','standalone','reduced','failure','fast']){
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:mode==='reduced'?'reduce':'no-preference'});
  await page.addInitScript(()=>{const request=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window);window.pendingFrames=new Set();window.requestAnimationFrame=fn=>{let id;id=request(t=>{window.pendingFrames.delete(id);fn(t)});window.pendingFrames.add(id);return id;};window.cancelAnimationFrame=id=>{window.pendingFrames.delete(id);cancel(id)};});
  if(mode==='standalone')await page.addInitScript(()=>Object.defineProperty(navigator,'standalone',{value:true}));
  let releaseSession,releaseJobs;const sessionGate=new Promise(r=>releaseSession=r),jobsGate=new Promise(r=>releaseJobs=r);
  await page.route('**/api/me',async route=>{await sessionGate;await route.fulfill({json:{data:{id:'fixture',role:'cleaner',displayName:'Fixture'}}});});
  await page.route('**/api/jobs?*',async route=>{await jobsGate;await route.fulfill(mode==='failure'?{status:503,json:{error:{code:'SOURCE_UNAVAILABLE',message:'Fixture startup failed'}}}:{json:{data:[]}});});
  await page.goto('http://127.0.0.1:'+server.address().port);const splash=page.getByRole('status',{name:'Loading Bloom'});await splash.waitFor();
  assert.equal(await splash.innerText(),'');assert.equal(await splash.locator('ellipse').count(),6);
  const mark=await splash.locator('svg').boundingBox();assert(Math.abs(mark.x+mark.width/2-195)<1);assert(Math.abs(mark.y+mark.height/2-422)<1);
  await page.addInitScript(()=>{const request=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window);window.pendingFrames=new Set();window.requestAnimationFrame=fn=>{let id;id=request(t=>{window.pendingFrames.delete(id);fn(t)});window.pendingFrames.add(id);return id;};window.cancelAnimationFrame=id=>{window.pendingFrames.delete(id);cancel(id)};});
  if(mode==='standalone'){await page.waitForTimeout(2100);const petals=await splash.locator('.petal').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('transform')));assert(petals.every(v=>v==='scale(1)'));await page.waitForTimeout(900);assert((await splash.locator('.petal').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('transform')))).every(v=>v==='scale(1)'));}
  if(mode==='browser'){await page.waitForTimeout(2900);assert((await splash.locator('.petal').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('transform')))).some(v=>v!=='scale(1)'));}
  if(mode==='reduced')assert((await splash.locator('.petal').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('transform')))).every(v=>v==='scale(1)'));
  if(mode==='browser'){await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(50);assert((await splash.locator('.petal').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('transform')))).every(v=>v==='scale(1)'));await page.emulateMedia({reducedMotion:'no-preference'});}
  await page.setViewportSize({width:430,height:620});await page.waitForTimeout(100);const resized=await splash.locator('svg').boundingBox();assert(Math.abs(resized.x+resized.width/2-215)<1);assert(Math.abs(resized.y+resized.height/2-310)<1);
  releaseSession();await page.waitForTimeout(100);assert(await splash.isVisible());releaseJobs();await splash.waitFor({state:'detached',timeout:1500});
  if(mode==='failure'){await page.getByText('Fixture startup failed').waitFor();await page.getByRole('button',{name:'Try again'}).click();assert.equal(await splash.count(),0);}
  else{await page.getByRole('heading',{name:'Ready hub'}).waitFor();await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.waitForTimeout(100);assert.equal(await splash.count(),0);}
  await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>window.pendingFrames.size),0);
  console.log('PASS '+mode+': source flower, readiness, session-to-data handoff, no refresh splash.');await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
