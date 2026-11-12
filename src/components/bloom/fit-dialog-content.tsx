'use client';
import {useLayoutEffect,useRef,type ReactNode} from 'react';

/** Below this scale the overview scrolls instead of shrinking further. */
const MIN_SCALE=0.7;

/**
 * Scale a finite overview inside its existing dialog size, without removing content.
 * With `fill`, short content may also scale up (to 125%) so trailing actions reach the frame bottom.
 *
 * `zoom` goes on the inner element and the height is read from the unzoomed outer wrapper:
 * WebKit (iOS Safari) reports a zoomed element's own rect without the zoom, so measuring the
 * zoomed node itself never shrinks and collapses the content toward the search floor.
 */
export function FitDialogContent({children,fill=false}:{children:ReactNode;fill?:boolean}){
 const outer=useRef<HTMLDivElement>(null);
 const content=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const frameBox=outer.current!,body=content.current!,viewport=frameBox.closest('dialog')?.querySelector<HTMLElement>('[data-bloom-dialog-scroll]');
  if(!viewport||!CSS.supports('zoom','0.8'))return;
  const previous={height:viewport.style.height,overflow:viewport.style.overflowY};
  let frame=0,locked=false,disposed=false,last='';
  // Layout height (offsetHeight ignores ancestor transforms such as the dialog's open animation).
  const layoutHeight=()=>frameBox.offsetHeight;
  const signatureOf=()=>[viewport.clientWidth,viewport.clientHeight,layoutHeight()].join(':');
  const measure=()=>{
   frame=0;if(disposed||!viewport.clientHeight)return;
   if(signatureOf()===last)return;
   // Capture the original frame before zoom changes its intrinsic content height.
   if(!locked){viewport.style.height=`${viewport.clientHeight}px`;locked=true;}
   const available=viewport.clientHeight-2;
   const heightAt=(scale:number)=>{body.style.zoom=String(scale);return layoutHeight();};
   // Largest scale that fits; fill also searches above 1 so short content reaches the bottom.
   const max=fill?1.25:1;
   let scale=max;
   if(heightAt(max)>available){
    let low=MIN_SCALE,high=max;
    for(let i=0;i<10;i++){const middle=(low+high)/2;if(heightAt(middle)<=available)low=middle;else high=middle;}
    scale=low;
   }
   // Scroll rather than shrink past the floor (or past a browser minimum font size).
   const fits=heightAt(scale)<=available;
   viewport.style.overflowY=fits?'hidden':'auto';
   body.dataset.bloomContentScale=String(scale);viewport.scrollTop=0;
   last=signatureOf();
  };
  const schedule=()=>{if(!frame&&!disposed)frame=requestAnimationFrame(measure);};
  const observer=new ResizeObserver(schedule);observer.observe(viewport);observer.observe(frameBox);
  window.addEventListener('resize',schedule);void document.fonts.ready.then(schedule);schedule();
  return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',schedule);body.style.zoom='';viewport.style.height=previous.height;viewport.style.overflowY=previous.overflow;};
 },[fill]);
 return <div ref={outer} style={{display:'flow-root',minWidth:0}}><div ref={content} style={{display:'flow-root',minWidth:0}}>{children}</div></div>;
}
