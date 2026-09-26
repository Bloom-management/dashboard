// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-shared-select-visual';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {Select} from './src/components/ui/select';import './src/styles/bloom-application.css';import './src/styles/bloom-cleaner.css';import './src/components/bloom/cleaner-payouts.css';createRoot(document.getElementById('root')).render(<div className="bloom-cleaner"><form className="cleaner-payouts"><label className="cp-card cp-payer-picker"><span>Payer</span><Select aria-label="Payer" name="payer" defaultValue="bloom"><option value="bloom">Bloom Cleaning</option><option value="owner">Property owner</option></Select></label><label className="bloom-form">Disabled<Select aria-label="Disabled" disabled><option>Bloom Cleaning</option></Select></label></form></div>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=calendar');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const width of [320,390,1440]){
  const page=await browser.newPage({viewport:{width,height:850}});await page.goto('http://127.0.0.1:'+server.address().port);
  const picker=page.getByRole('combobox',{name:'Payer',exact:true});await picker.waitFor();
  const css=await picker.evaluate(el=>{const s=getComputedStyle(el);return {appearance:s.appearance,padding:s.paddingRight,position:s.backgroundPosition,size:s.backgroundSize}});
  assert.equal(css.appearance,'none');assert.equal(css.padding,'48px');assert.equal(css.size,'16px 16px');assert(css.position.includes('50%')&&css.position.includes('16px'));
  await picker.selectOption('owner');assert.equal(await page.locator('form').evaluate(el=>new FormData(el).get('payer')),'owner');assert(await page.getByRole('combobox',{name:'Disabled',exact:true}).isDisabled());
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:`${out}/select-${width}.png`});console.log(`PASS ${width}: fixed chevron gutter, centered arrow, native form value and disabled state`);await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
