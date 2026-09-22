// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-pending-visual';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {PendingInvitations} from './src/components/bloom/pending-invitations';import './src/styles/bloom-owner.css';import './src/styles/bloom-application.css';createRoot(document.getElementById('root')).render(<main className="bloom-owner"><PendingInvitations revision={0}/></main>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-only-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=people');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:850}});let sends=0;
  await page.route('**/api/admin/invitations',async route=>{if(route.request().method()==='POST'){sends++;assert.deepEqual(Object.keys(route.request().postDataJSON()).sort(),['email','invitationId']);assert(route.request().headers()['idempotency-key']);await route.fulfill({json:{data:{status:'pending'}}});}else await route.fulfill({json:{data:[{id:'invitation',email:'pending@example.com',role:null}]}});});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.getByText('pending@example.com').waitFor();assert.equal(await page.locator('.bloom-pending-label').textContent(),'Pending');await page.getByRole('button',{name:'Resend invite',exact:true}).click();await page.getByRole('button',{name:'Invite resent',exact:true}).waitFor();assert.equal(sends,1);assert(await page.getByRole('button',{name:'Invite resent',exact:true}).isDisabled());
  console.log('PASS '+width+': pending badge and one mocked resend with retained receipt.');await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
