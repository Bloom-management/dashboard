'use client';
import {useLayoutEffect,useRef,type ComponentProps} from 'react';
/** Shared animated Bloom selector; respects reduced motion for every consumer. */
export function SelectorPill({className='',children,...props}:ComponentProps<'nav'>){
 const root=useRef<HTMLElement>(null);
 useLayoutEffect(()=>{
  const element=root.current!;
  const measure=()=>{const active=element.querySelector<HTMLElement>('.vt-btn.active');if(!active)return;const box=active.getBoundingClientRect(),parent=element.getBoundingClientRect();element.style.setProperty('--selector-x',`${box.left-parent.left-element.clientLeft+element.scrollLeft}px`);element.style.setProperty('--selector-y',`${box.top-parent.top-element.clientTop+element.scrollTop}px`);element.style.setProperty('--selector-width',`${box.width}px`);element.style.setProperty('--selector-height',`${box.height}px`);element.dataset.slider='ready';
   // Single-row pills scroll sideways: keep the active tab in view.
   if(element.scrollWidth>element.clientWidth){const left=box.left-parent.left+element.scrollLeft,pad=8;if(left<element.scrollLeft+pad)element.scrollLeft=Math.max(0,left-pad);else if(left+box.width>element.scrollLeft+element.clientWidth-pad)element.scrollLeft=left+box.width-element.clientWidth+pad;}
  };
  measure();const resize=new ResizeObserver(measure);resize.observe(element);element.querySelectorAll('button').forEach(button=>resize.observe(button));
  const mutation=new MutationObserver(measure);mutation.observe(element,{subtree:true,attributes:true,attributeFilter:['class','aria-pressed','aria-current'],childList:true});
  return()=>{resize.disconnect();mutation.disconnect();};
 },[]);
 return <nav {...props} ref={root} className={`view-toggle bloom-selector-pill ${className}`}><span className="bloom-selector-indicator" aria-hidden="true"/>{children}</nav>;
}
