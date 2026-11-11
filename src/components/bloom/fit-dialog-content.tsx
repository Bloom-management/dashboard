'use client';
import {useLayoutEffect,useRef,type ReactNode} from 'react';

/**
 * Scale a finite overview inside its existing dialog size, without removing content.
 * With `fill`, short content may also scale up (to 125%) so trailing actions reach the frame bottom.
 */
export function FitDialogContent({children,fill=false}:{children:ReactNode;fill?:boolean}){
 const content=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const body=content.current!,viewport=body.closest('dialog')?.querySelector<HTMLElement>('[data-bloom-dialog-scroll]');
  if(!viewport||!CSS.supports('zoom','0.8'))return;
  const previous={height:viewport.style.height,overflow:viewport.style.overflowY};
  let frame=0,locked=false,disposed=false,last='';
  // Layout height, independent of ancestor transforms such as the dialog's open animation.
  const layoutHeight=()=>{const ratio=viewport.getBoundingClientRect().height/viewport.offsetHeight||1;return body.getBoundingClientRect().height/ratio;};
  const signatureOf=()=>[viewport.clientWidth,viewport.clientHeight,layoutHeight().toFixed(1)].join(':');
  const measure=()=>{
   frame=0;if(disposed||!viewport.clientHeight)return;
   if(signatureOf()===last)return;
   // Capture the original frame before zoom changes its intrinsic content height.
   if(!locked){viewport.style.height=`${viewport.clientHeight}px`;viewport.style.overflowY='hidden';locked=true;}
   const available=viewport.clientHeight-2;
   const heightAt=(scale:number)=>{body.style.zoom=String(scale);return layoutHeight();};
   // Largest scale that fits; fill also searches above 1 so short content reaches the bottom.
   const max=fill?1.25:1;
   let scale=max;
   if(heightAt(max)>available){
    let low=0.05,high=max;
    for(let i=0;i<14;i++){const middle=(low+high)/2;if(heightAt(middle)<=available)low=middle;else high=middle;}
    scale=low;
   }
   heightAt(scale);
   body.dataset.bloomContentScale=String(scale);viewport.scrollTop=0;
   last=signatureOf();
  };
  const schedule=()=>{if(!frame&&!disposed)frame=requestAnimationFrame(measure);};
  const observer=new ResizeObserver(schedule);observer.observe(viewport);observer.observe(body);
  window.addEventListener('resize',schedule);void document.fonts.ready.then(schedule);schedule();
  return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',schedule);viewport.style.height=previous.height;viewport.style.overflowY=previous.overflow;};
 },[fill]);
 return <div ref={content} style={{display:'flow-root',minWidth:0}}>{children}</div>;
}
