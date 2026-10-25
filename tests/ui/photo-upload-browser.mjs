/** Real React/browser behavior with isolated API/storage fixtures. */
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import('/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs');
const out='/tmp/bloom-photo-upload-check';await mkdir(out,{recursive:true});
await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import {Photos} from './src/components/bloom/photos';import {RoleGate} from './src/components/bloom/primitives';import {ApiError} from './src/components/bloom/api';import './src/styles/bloom-application.css';
const job={id:'job',myAssignmentId:'assignment',status:'open',reviewRequired:false};const rooms=[{id:'room',type:'bedrooms',label:'Bedroom'}];
window.attempts=0;window.prepares=0;
const integration={prepareUpload:async()=>{window.prepares++;return {photoId:'photo',upload:async(file,progress)=>{const image=await createImageBitmap(file);window.dimensions=[image.width,image.height];image.close();window.attempts++;if(window.attempts===1)throw new ApiError('NETWORK_ERROR','Interrupted');await new Promise(resolve=>window.finishUpload=resolve);progress(100);}}}};
createRoot(document.getElementById('root')).render(<RoleGate role="cleaner">{user=><div className="bloom-cleaner"><h1 tabIndex={-1}>Photo check</h1><Photos job={job} user={user} rooms={rooms} integration={integration}/></div>}</RoleGate>);
`},bundle:true,outfile:`${out}/app.js`,format:'esm',platform:'browser',jsx:'automatic',external:['/fonts/*'],plugins:[{name:'next-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams();",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(out+req.url));}else res.end('<html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});let offline=false;let saved=false;
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;if(offline&&path==='/api/me')return route.fulfill({status:503,json:{error:{code:'SOURCE_UNAVAILABLE',message:'Temporary connection error'}}});const data=path==='/api/me'?{id:'cleaner',role:'cleaner',displayName:'Cleaner'}:path.endsWith('/finalize')?(saved=true,{id:'photo',state:'ready'}):saved?[{id:'photo',roomId:'room',category:'bedrooms',state:'ready',uploaderId:'cleaner'}]:[];return route.fulfill({json:{data}});});
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const input=page.locator('input[type=file][multiple]');await input.waitFor();await input.evaluate(el=>el.dataset.identity='original');
 const bytes=await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=4000;c.height=3000;c.getContext('2d').fillRect(0,0,4000,3000);return Array.from(new Uint8Array(await (await new Promise(r=>c.toBlob(r,'image/jpeg'))).arrayBuffer()));});
 await input.setInputFiles({name:'camera.jpg',mimeType:'image/jpeg',buffer:Buffer.from(bytes)});
 await page.getByText('Upload failed',{exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.dimensions),[2560,1920]);
 offline=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(300);
 assert.equal(await input.getAttribute('data-identity'),'original');
 await page.getByRole('button',{name:/retry|try again/i}).last().click();await page.waitForFunction(()=>typeof window.finishUpload==='function');
 await page.clock.install();await page.clock.fastForward(31000);
 assert.equal(await input.getAttribute('data-identity'),'original');
 await page.evaluate(()=>window.finishUpload());await page.getByText('Photo saved',{exact:false}).waitFor();
 assert.equal(await page.evaluate(()=>window.prepares),1);
 await page.locator('h1').focus();assert.equal(await page.locator('h1').evaluate(el=>getComputedStyle(el).outlineStyle),'none');
 console.log('PASS large-photo resize, interrupted upload retry, session refresh preservation, polling stability, focus outline');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
