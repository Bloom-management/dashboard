// Uses the already-open Cleaner Test page. No browser launch, account switch or job mutation.
import {inExistingPreview} from '../../scripts/room-listings/existing-preview.mjs';
const result=await inExistingPreview(async(page,args,browser,{useWindowSize})=>{
 const assert=process.getBuiltinModule('assert').strict;
 const cdp=await page.context().newCDPSession(page);const bounds=await cdp.send('Browser.getWindowForTarget');page.setDefaultTimeout(15000);
 let dialog=page.locator('dialog').last();
 if(await dialog.getByRole('button',{name:'Maintenance',exact:true}).count())await dialog.getByRole('button',{name:'Maintenance',exact:true}).click();
 dialog=page.locator('dialog').last();
 if(await dialog.getByRole('button',{name:'Room',exact:true}).count())await dialog.getByRole('button',{name:'Room',exact:true}).click();
 const trigger=dialog.getByRole('button',{name:/^Room: /});await trigger.waitFor();
 const original=await trigger.getAttribute('aria-label');const checks=[];
 try{
  for(const width of [390,1280]){
   await page.setViewportSize({width,height:950});await trigger.scrollIntoViewIfNeeded();await trigger.click();
   const menu=page.getByRole('menu');await menu.waitFor();
   const anchor=await trigger.boundingBox(),popup=await menu.boundingBox(),surface=await dialog.boundingBox();
   assert(Math.abs(popup.width-anchor.width)<2,JSON.stringify({anchor,popup}));
   assert(Math.abs(popup.x-anchor.x)<2,JSON.stringify({anchor,popup}));
   assert(popup.x>=0&&popup.x+popup.width<=width+1);
   assert(popup.y>=surface.y&&popup.y+popup.height<=surface.y+surface.height+1);
   assert.equal(await menu.getByRole('menuitemradio').count(),4);
   await page.screenshot({path:`.bloom-local/private/room-picker-existing-${width}.png`});
   await menu.getByRole('menuitemradio',{name:'DH2',exact:true}).click();
   assert.equal(await trigger.getAttribute('aria-label'),'Room: DH2');
   await page.getByText('TV',{exact:true}).waitFor();
   await trigger.focus();await page.keyboard.press('ArrowDown');await menu.waitFor();await page.keyboard.press('End');await page.keyboard.press('Enter');
   assert.equal(await trigger.getAttribute('aria-label'),'Room: DH4');
   await trigger.click();await menu.waitFor();await page.keyboard.press('Escape');assert.equal(await menu.count(),0);
   assert.equal(await page.locator('dialog[open]').count(),1);
   checks.push({width,aligned:true,withinDialog:true,mouseAndKeyboard:true});
  }
 }finally{
  if(await page.getByRole('menu').count())await page.keyboard.press('Escape');
  await trigger.click();await page.getByRole('menuitemradio',{name:original.replace('Room: ',''),exact:true}).click();
  await useWindowSize();await cdp.send('Browser.setWindowBounds',{windowId:bounds.windowId,bounds:bounds.bounds});await cdp.detach();
 }
 return {existingPage:page.url(),checks};
});console.log(JSON.stringify(result,null,2));
