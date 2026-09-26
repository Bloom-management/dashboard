// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-shared-inbox-visual';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {NotificationInbox} from './src/components/push/inbox';import './src/styles/bloom-cleaner.css';import './src/styles/bloom-application.css';createRoot(document.getElementById('root')).render(<div className="bloom-owner"><NotificationInbox cleaner={location.search.includes('cleaner')}/></div>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=calendar');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const cleaner of [false,true]){
  const page=await browser.newPage({viewport:{width:390,height:850}});
  await page.route('**/api/notifications*',route=>route.fulfill({json:{data:{items:cleaner?[]:[{id:'owner:first-listing',body:'Add your first listing',href:'/owner?view=listings&create=1',dismissible:false}],total:cleaner?0:1}}}));
  await page.goto('http://127.0.0.1:'+server.address().port+(cleaner?'/?cleaner':'/owner'));
  await page.getByRole('button',{name:/^Notifications/}).click();const gear=page.getByRole('button',{name:'Notification settings',exact:true});await gear.waitFor();assert.equal(await gear.isDisabled(),!cleaner);
  const heading=await page.getByRole('heading',{name:'Notifications',exact:true}).boundingBox(),icon=await gear.boundingBox();assert(Math.abs(heading.y+heading.height/2-icon.y-icon.height/2)<2);
  if(!cleaner){await page.getByRole('link',{name:/Add your first listing/}).waitFor();await page.evaluate(()=>{window.listingOpened=false;window.addEventListener('bloom:add-listing',()=>{window.listingOpened=true})});await page.getByRole('link',{name:/Add your first listing/}).click();assert(await page.evaluate(()=>window.listingOpened));}
  else{await page.evaluate(()=>{window.settingsOpened=false;window.addEventListener('bloom:notification-settings',()=>{window.settingsOpened=true})});await gear.click();assert(await page.evaluate(()=>window.settingsOpened));}
  console.log('PASS shared inbox: '+(cleaner?'cleaner settings action':'owner disabled gear and listing action'));await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
