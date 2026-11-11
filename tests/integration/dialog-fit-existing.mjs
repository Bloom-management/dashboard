// Tests scaling in the existing Cleaner Test window without claiming or reporting.
import {inExistingPreview} from '../../scripts/room-listings/existing-preview.mjs';
const result=await inExistingPreview(async(page,args,browser,{useWindowSize})=>{
 const assert=process.getBuiltinModule('assert').strict;
 const cdp=await page.context().newCDPSession(page),initial=await cdp.send('Browser.getWindowForTarget');
 let dialog=page.locator('dialog[open]').last();await dialog.locator('[data-bloom-content-scale]').waitFor();
 const original=await dialog.textContent();const checks=[];
 async function verify(label){
  await page.waitForTimeout(650);
  const result=await dialog.evaluate(d=>{const r=d.getBoundingClientRect(),b=d.querySelector('[data-bloom-content-scale]'),s=d.querySelector('[data-bloom-dialog-scroll]'),claim=[...d.querySelectorAll('button')].find(b=>b.textContent==='Claim this cleaning');return {frame:r.toJSON(),scale:Number(b.dataset.bloomContentScale),scrolling:s.scrollHeight>s.clientHeight+1,viewport:[innerWidth,innerHeight],claim:claim?.getBoundingClientRect().toJSON(),overflowing:[...b.querySelectorAll('button,p,h2,.info-row,.payout')].filter(e=>{const box=e.getBoundingClientRect();return box.width>1&&box.height>1&&(box.top<r.top-1||box.bottom>r.bottom+1||box.left<r.left-1||box.right>r.right+1);}).map(e=>e.textContent)};});
  assert.equal(result.scrolling,false,JSON.stringify(result));assert.equal(result.overflowing.length,0,JSON.stringify(result));
  assert(result.claim.top>=result.frame.top&&result.claim.bottom<=result.frame.bottom);
  assert(result.frame.top>=0&&result.frame.bottom<=result.viewport[1]+1);
  assert(result.scale>0&&result.scale<1);assert.equal(await dialog.textContent(),original);
  await dialog.screenshot({path:`.bloom-local/private/dialog-fit-${label}.png`});checks.push({size:label,width:result.frame.width,height:result.frame.height,scale:result.scale,claimVisible:true,allContentsFit:true});
 }
 try{
  await useWindowSize();await verify('native');
  assert.equal(checks[0].width,460);assert.equal(checks[0].height,667);
  await dialog.getByRole('button',{name:'Supplies',exact:true}).click();await page.getByText('Toilet paper',{exact:true}).waitFor();await page.getByRole('button',{name:'← Back to cleaning',exact:true}).click();dialog=page.locator('dialog[open]').last();await verify('returned');
  await page.setViewportSize({width:390,height:640});await verify('390x640');
  await page.setViewportSize({width:1280,height:720});await verify('1280x720');
 }finally{await useWindowSize();await cdp.send('Browser.setWindowBounds',{windowId:initial.windowId,bounds:initial.bounds});await cdp.detach();}
 await page.waitForTimeout(650);return {existingPage:page.url(),checks,restoredViewport:await page.evaluate(()=>({height:innerHeight,windowHeight:outerHeight}))};
});console.log(JSON.stringify(result,null,2));
