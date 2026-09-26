// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-city-dialog-visual';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {LocationDropdown} from './src/components/bloom/location-dropdown';import './src/styles/bloom-application.css';function App(){const [city,setCity]=useState('detroit');return <LocationDropdown label="Choose city" locations={[{id:'detroit',name:'Detroit'},{id:'chicago',name:'Chicago'}]} value={city} onValueChange={setCity}/>};createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=calendar');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:850}});await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('button',{name:'Choose city: Detroit',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Choose city',exact:true});await dialog.waitFor();
  await page.getByRole('textbox',{name:'Search locations'}).fill('Chi');await dialog.getByRole('button',{name:'Chicago',exact:true}).click();await page.getByRole('button',{name:'Choose city: Chicago',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);
  await page.getByRole('button',{name:'Choose city: Chicago',exact:true}).click();await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'Choose city: Chicago',exact:true}).evaluate(el=>el===document.activeElement),true);
  console.log('PASS '+width+': city dialog search, selection, Escape and focus return');await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
