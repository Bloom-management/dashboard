// Reuse an already-open managed preview. Never launches Chrome.
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';

export async function inExistingPreview(fn,args={}){
 const rows=execFileSync('ps',['-axo','pid,ppid,command'],{encoding:'utf8'}).split('\n').map(line=>line.trim().match(/^(\d+) +(\d+) +(.+)$/)).filter(Boolean);
 const processes=rows.filter(p=>p[3].startsWith('node scripts/room-listings/open-preview.mjs')&&rows.some(child=>child[2]===p[1]&&child[3].startsWith('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome ')&&child[3].includes('playwright_chromiumdev_profile-')));
 const chosen=processes.filter(p=>p[3].includes('--walkthrough')).at(-1)??processes.at(-1);
 if(!chosen)throw Error('No existing managed preview is open. Browser launch is disabled.');
 const pid=Number(chosen[1]);let endpoint;
 async function discovery(){try{return (await(await fetch('http://127.0.0.1:9229/json/list')).json())[0]?.webSocketDebuggerUrl;}catch{return undefined;}}
 endpoint=await discovery();
 if(!endpoint){process.kill(pid,'SIGUSR1');for(let i=0;i<20&&!endpoint;i++){await new Promise(r=>setTimeout(r,100));endpoint=await discovery();}}
 if(!endpoint)throw Error('The existing preview could not be attached. No browser was opened.');
 const socket=new WebSocket(endpoint),pending=new Map();let next=0;
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const data=JSON.parse(event.data);const operation=pending.get(data.id);if(operation){pending.delete(data.id);if(data.error)operation.reject(Error(data.error.message));else operation.resolve(data.result);}});
 const call=(method,params)=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 try{
  const check=await call('Runtime.evaluate',{expression:'process.pid',returnByValue:true});if(check.result.value!==pid)throw Error('Another Node debugger occupies the local attachment port. No browser was opened.');
  const modulePath=process.cwd()+'/.bloom-local/private/browser-tools/node_modules/playwright/index.js';
  const expression=`(async()=>{const pw=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')(${JSON.stringify(modulePath)});const browser=[...pw.chromium._connection._objects.values()].find(o=>o._type==='Browser');if(!browser)throw Error('Existing preview browser unavailable');const pages=browser.contexts().flatMap(c=>c.pages());let page=pages.findLast(p=>p.url().startsWith('http://localhost:3000/'))??pages.at(-1);if(!page){const context=browser.contexts()[0];if(!context)throw Error('Existing browser has no preview context');page=await context.newPage();const f=JSON.parse(process.getBuiltinModule('fs').readFileSync(process.cwd()+'/.bloom-local/private/atam-cleaner-walkthrough.json','utf8'));await page.goto(f.url,{waitUntil:'domcontentloaded'});}const useWindowSize=async(target=page)=>{const impl=target._connection.toImpl(target);impl._emulatedSize=null;impl.browserContext._options.viewport=null;impl.browserContext._options.screen=null;impl.browserContext._options.noDefaultViewport=true;target.context()._options.viewport=null;target._viewportSize=null;await impl.delegate._mainFrameSession._client.send('Emulation.clearDeviceMetricsOverride');impl.delegate._mainFrameSession._metricsOverride=undefined;};return await (${fn.toString()})(page,${JSON.stringify(args)},browser,{useWindowSize});})()`;
  const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,timeout:120000});
  if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);
  return result.result.value;
 }finally{socket.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const path=process.argv[2];if(!path)throw Error('Provide a trusted local script exporting an async (page, args, browser) function.');
 const {default:operation}=await import(pathToFileURL(path).href);const args=process.argv[3]?JSON.parse(readFileSync(process.argv[3],'utf8')):{};console.log(JSON.stringify(await inExistingPreview(operation,args),null,2));
}
