'use client';
import {useLayoutEffect,useRef,type ReactNode} from 'react';

/** Shared resize transition for dialog screens and cards with changing content. */
export function AnimatedContent({children}:{children:ReactNode}) {
 const shell=useRef<HTMLDivElement>(null),content=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const outer=shell.current!,inner=content.current!;
  let previous:number|undefined;
  let animation:Animation|undefined;
  const measure=()=>{
   const next=inner.getBoundingClientRect().height;
   if(previous===next)return;
   const from=outer.getBoundingClientRect().height;
   animation?.cancel();
   outer.style.height=`${next}px`;
   if(previous!==undefined&&previous>0&&next>0&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    animation=outer.animate([{height:`${from}px`},{height:`${next}px`}],{duration:480,easing:'cubic-bezier(.4,0,.2,1)'});
   }
   previous=next;
  };
  measure();const observer=new ResizeObserver(measure);observer.observe(inner);
  return()=>{observer.disconnect();animation?.cancel();};
 },[]);
 return <div ref={shell} style={{overflow:'clip'}}><div ref={content} style={{display:'flow-root'}}>{children}</div></div>;
}
