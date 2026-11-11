// Exercise the user's existing dialog. No browser launch, login or job mutation.
import {inExistingPreview} from '../../scripts/room-listings/existing-preview.mjs';
const result=await inExistingPreview(async(page,args,browser,{useWindowSize})=>{
 const assert=process.getBuiltinModule('assert').strict;
 const cdp=await page.context().newCDPSession(page),initial=await cdp.send('Browser.getWindowForTarget');
 const dialog=page.locator('dialog[open]').last();await dialog.waitFor();await page.waitForTimeout(600);
 const original=await dialog.textContent();
 const originalScroll=await dialog.evaluate(d=>{const e=[...d.querySelectorAll('*')].find(e=>/(auto|scroll)/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight);return e?.scrollTop??0;});
 const checks=[];
 async function check(label){
  await page.waitForTimeout(600);
  const surface=await dialog.evaluate(d=>{const r=d.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight};});
  assert(surface.left>=0&&surface.top>=0&&surface.right<=surface.w+1&&surface.bottom<=surface.h+1,JSON.stringify(surface));
  const scroll=await dialog.evaluate(d=>{const e=[...d.querySelectorAll('*')].find(e=>/(auto|scroll)/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight);if(!e)return null;e.scrollTop=e.scrollHeight;return {height:e.clientHeight,content:e.scrollHeight};});
  if(scroll){const last=dialog.getByRole('button',{name:'Claim this cleaning',exact:true});if(await last.count()){await last.scrollIntoViewIfNeeded();assert(await last.isVisible());}}
  const after=await dialog.boundingBox();assert(after.y>=0&&after.y+after.height<=surface.h+1);
  assert.equal(await dialog.textContent(),original);
  await dialog.screenshot({path:`.bloom-local/private/dialog-viewport-${label}.png`});
  checks.push({size:label,frameInsideViewport:true,contentsUnchanged:true,internalScroll:!!scroll});
 }
 try{
  await useWindowSize();await check('native');
  await cdp.send('Browser.setWindowBounds',{windowId:initial.windowId,bounds:{width:1040,height:650}});await check('short-desktop');
  await page.setViewportSize({width:390,height:640});await check('390x640');
  await page.setViewportSize({width:1280,height:720});await check('1280x720');
 }finally{
  await useWindowSize();await cdp.send('Browser.setWindowBounds',{windowId:initial.windowId,bounds:initial.bounds});
  await dialog.evaluate((d,top)=>{const e=[...d.querySelectorAll('*')].find(e=>/(auto|scroll)/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight);if(e)e.scrollTop=top;},originalScroll);
  await cdp.detach();
 }
 const native=await page.evaluate(()=>({viewportHeight:innerHeight,windowHeight:outerHeight,screenHeight:screen.height}));
 assert(native.viewportHeight<native.windowHeight,'Preview must follow the real window, not a fixed emulated height.');
 return {checks,native};
});console.log(JSON.stringify(result,null,2));
