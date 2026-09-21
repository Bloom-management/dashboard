// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-property-people-visual';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {PropertyPeoplePanel} from './src/components/bloom/property-people';import './src/styles/bloom-cleaner.css';import './src/styles/bloom-application.css';import './src/styles/bloom-owner.css';createRoot(document.getElementById('root')).render(<PropertyPeoplePanel listing={{id:'test',name:'Test property'}}/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-only-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=people');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.route('**/api/**',route=>route.fulfill({json:{data:{propertyId:'test',bloomOwned:false,members:Array.from({length:21},(_,i)=>({id:String(i),displayName:'Person '+(i+1),location:'City '+(i+1),imageUrl:null})),invitations:[]}}}));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('cell',{name:'City 1',exact:true}).waitFor();
  assert.equal(await page.locator('tbody tr').count(),10);
  assert.equal(await page.getByText('Person 11',{exact:true}).count(),0);
  const nav=page.getByRole('navigation',{name:'Owners pages'});
  await nav.getByRole('button',{name:'Next page'}).click();
  await page.getByRole('cell',{name:'City 11',exact:true}).waitFor();
  assert.equal(await page.locator('tbody tr').count(),10);
  await nav.getByRole('button',{name:'Next page'}).click();
  assert.equal(await page.locator('tbody tr').count(),1);
  assert.equal(await nav.getByRole('button',{name:'Next page'}).isDisabled(),true);
  await nav.getByRole('button',{name:'Previous page'}).click();
  await page.getByRole('cell',{name:'City 11',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  console.log('PASS mocked property people '+width+': 10/10/1 rows, next/back, location, no overflow');
  await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
