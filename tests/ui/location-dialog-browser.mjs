// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-location-dialog-visual';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {Modal} from './src/components/bloom/primitives';import {LocationDropdown} from './src/components/bloom/location-dropdown';import './src/styles/bloom-cleaner.css';import './src/styles/bloom-owner.css';import './src/styles/bloom-application.css';function App(){const [value,setValue]=React.useState('');return <div className="bloom-cleaner app"><Modal title="Change city" onClose={()=>{}} className="owner-create-dialog cleaner-city-dialog"><div className="cleaner-city-body"><h2>Request a city change</h2><LocationDropdown label="City" locations={[{id:'chicago',name:'Chicago'},{id:'boston',name:'Boston'}]} value={value} onValueChange={setValue}/></div></Modal></div>}createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-only-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=properties');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('button',{name:'City: Choose city'}).click();
  const option=page.getByRole('menuitemradio',{name:'Chicago',exact:true});
  await option.waitFor();
  assert.equal(await option.evaluate(el=>!!el.closest('dialog[open]')),true);
  const triggerBox=await page.getByRole('button',{name:'City: Choose city'}).boundingBox();
  const optionBox=await option.boundingBox();
  assert.ok(optionBox.y>=triggerBox.y+triggerBox.height,'options open below trigger');
  const last=page.getByRole('menuitemradio',{name:'Boston',exact:true});
  assert.ok(await last.evaluate(el=>{
   const r=el.getBoundingClientRect();
   return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
  }),'last option is painted and hit-testable without scrolling the dialog');
  await page.screenshot({path:out+'/menu-'+width+'.png'});
  await option.click();
  await page.getByRole('button',{name:'City: Chicago'}).waitFor();
  await page.getByRole('button',{name:'City: Chicago'}).click();
  await page.getByLabel('Search locations').fill('Boston');
  await page.getByRole('menuitemradio',{name:'Boston',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(),1);
  await page.getByRole('menuitemradio').waitFor({state:'hidden'});
  console.log('PASS '+width+': menu inside modal, selection, search and Escape');
  await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
