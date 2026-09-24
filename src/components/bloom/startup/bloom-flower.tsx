 'use client';
import {useEffect,useRef} from 'react';
import styles from './startup.module.css';
// Extracted from Open Design db82b160-03a5-427c-8c5e-03bc293b5c17/index.html.
// Preserve literal SVG attributes, paint order, overlap, easing and timing.
const timing = Object.freeze({centerLead:200, petal:320, stagger:340, hold:640, reset:200});
export function BloomFlower({mode='loop'}:{mode?:'once'|'loop'}){
 const flower=useRef<SVGSVGElement>(null);
 useEffect(()=>{
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const petals=[...flower.current!.querySelectorAll<SVGGElement>('.petal')];
  let frame=0;
  function start(){
   cancelAnimationFrame(frame);
   const mobile=mode==='once';
   const revealEnd=timing.centerLead+4*timing.stagger+timing.petal;
   const resetStart=revealEnd+timing.hold;
   const total=resetStart+timing.reset;
   const set=(el:SVGGElement,scale:number,opacity:number)=>{el.setAttribute('transform',`scale(${scale})`);el.style.opacity=String(opacity);};
   if(media.matches){petals.forEach(p=>set(p,1,1));return;}
   petals.forEach(p=>set(p,0,0));
   const begin=performance.now();
   function tick(now:number){
    const elapsed=now-begin;
    const t=mobile?Math.min(elapsed,revealEnd):elapsed%total;
    petals.forEach(p=>{
     const progress=Math.max(0,Math.min(1,(t-timing.centerLead-Number(p.dataset.order)*timing.stagger)/timing.petal));
     const eased=1-Math.pow(1-progress,3);
     const fade=!mobile&&t>resetStart?1-Math.pow((t-resetStart)/timing.reset,2):1;
     set(p,eased,eased*fade);
    });
    if(!mobile||elapsed<revealEnd)frame=requestAnimationFrame(tick);
   }
   frame=requestAnimationFrame(tick);
  }
  media.addEventListener('change',start);start();
  return()=>{cancelAnimationFrame(frame);media.removeEventListener('change',start);};
 },[mode]);
 return <svg ref={flower} className={styles.flower} width="34" height="34" viewBox="0 0 40 40" aria-hidden="true"><g transform="translate(20 20)">
    <g className="petal" data-order="0"><ellipse cx="0" cy="-10" rx="6" ry="9" fill="#f0c4cb" /></g><g className="petal" data-order="2"><ellipse cx="9.5" cy="-3.1" rx="6" ry="9" fill="#e89ba9" transform="rotate(72)" /><ellipse cx="0" cy="3.5" rx="2" ry="2" fill="#e89ba9" /></g><g className="petal" data-order="4"><ellipse cx="5.9" cy="8.1" rx="6" ry="9" fill="#d97a85" transform="rotate(144)" /></g><g className="petal" data-order="1"><ellipse cx="-5.9" cy="8.1" rx="6" ry="9" fill="#e89ba9" transform="rotate(216)" /></g><g className="petal" data-order="3"><ellipse cx="-9.5" cy="-3.1" rx="6" ry="9" fill="#f0c4cb" transform="rotate(288)" /></g><circle cx="0" cy="0" r="3.5" fill="#2d2a1f" />
  </g></svg>;
}
