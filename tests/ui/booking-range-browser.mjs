// Isolated production-component checks, not authenticated integration.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.BLOOM_PLAYWRIGHT ?? '/tmp/bloom-journey-browser-tools/node_modules/playwright/index.mjs').href);
const out='/tmp/bloom-booking-range';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {BookingRangePicker} from './src/components/ui/booking-range-picker';function App(){const [value,onChange]=useState({checkIn:'',checkout:''});return <main style={{maxWidth:560,padding:16,margin:'auto',fontFamily:'sans-serif'}}><BookingRangePicker value={value} onChange={onChange} timezone="America/Detroit" initialDate="2026-10-01" unavailable={[{startDate:'2026-10-10',endDate:'2026-10-13'}]}/><output>{JSON.stringify(value)}</output></main>}createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:`${out}/app.js`,platform:'browser',format:'esm',external:['/fonts/*'],jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'},plugins:[{name:'framework-stubs',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p)};export const useRouter=()=>({push(){},refresh(){}});export const usePathname=()=>'/cleaner';export const useSearchParams=()=>new URLSearchParams('view=calendar');",loader:'js',resolveDir:process.cwd()}));}}]});
const server=createServer(async(req,res)=>{try{if(req.url.startsWith('/fonts/')){res.setHeader('Content-Type','font/ttf');res.end(await readFile(`public${req.url}`));}else if(req.url.startsWith('/app.')){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(`${out}${req.url}`));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');}}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLOOM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 for(const width of [320,390,1440]){
  const page=await browser.newPage({viewport:{width,height:950}});await page.goto('http://127.0.0.1:'+server.address().port);
  const day=(date)=>page.locator(`[data-booking-date="${date}"]`).first();
  const value=async()=>JSON.parse(await page.locator('output').textContent());
  await day('2026-10-08').click();await day('2026-10-10').hover();assert.equal(await day('2026-10-09').evaluate(el=>el.closest('td').getAttribute('aria-selected')),'true');await page.locator('output').hover();assert.notEqual(await day('2026-10-09').evaluate(el=>el.closest('td').getAttribute('aria-selected')),'true');await day('2026-10-10').click();assert.deepEqual(await value(),{checkIn:'2026-10-08',checkout:'2026-10-10'});assert.equal(await day('2026-10-08').evaluate(el=>el.closest('td').getAttribute('aria-selected')),'true');assert.notEqual(await day('2026-10-07').evaluate(el=>el.closest('td').getAttribute('aria-selected')),'true');
  await page.getByRole('button',{name:/^Check-in/}).click();await day('2026-10-08').click();await day('2026-10-14').click();assert.equal((await value()).checkout,'');assert(await page.getByRole('alert').isVisible());
  await day('2026-10-09').focus();await page.keyboard.press('Enter');assert.equal((await value()).checkout,'2026-10-09');
  await page.getByRole('button',{name:/^Check-in/}).click();await day('2026-10-30').click();await page.getByRole('button',{name:/next month/i}).click();await day('2026-11-02').click();assert.deepEqual(await value(),{checkIn:'2026-10-30',checkout:'2026-11-02'});assert(await page.getByText(/3 nights/).isVisible());
  if(width===1440){
    const start=await day('2026-11-05').boundingBox(),end=await day('2026-11-08').boundingBox();await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();await page.mouse.move(end.x+end.width/2,end.y+end.height/2,{steps:12});assert(await page.getByText(/3 nights/).isVisible());await page.mouse.up();assert.deepEqual(await value(),{checkIn:'2026-11-05',checkout:'2026-11-08'});
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:`${out}/range-${width}.png`});console.log(`PASS ${width}: adjacent checkout, blocked crossing, keyboard, cross-month preservation${width===1440?', drag':''}`);await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
