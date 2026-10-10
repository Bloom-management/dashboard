'use client';
import {useId,useRef,useState} from 'react';
import styles from './cleaner-journey.module.css';

export function GuestStars({value,onChange,disabled=false}:{value:number;onChange?:(value:number)=>void;disabled?:boolean}) {
 const gradientId=useId();
 const root=useRef<HTMLDivElement>(null);
 const dragging=useRef(false);
 const [preview,setPreview]=useState<number|null>(null);
 const at=(x:number)=>{const rect=root.current!.getBoundingClientRect();return Math.max(1,Math.min(5,Math.ceil((x-rect.left)/rect.width*10)/2));};
 const shown=preview??value;
 return <div ref={root} className={styles.starRating} role={onChange?'radiogroup':'img'} aria-label={onChange?'Guest rating':`Guest rating: ${value} out of 5`}
 onPointerDown={event=>{if(!onChange||disabled||event.button!==0)return;dragging.current=true;event.currentTarget.setPointerCapture(event.pointerId);setPreview(at(event.clientX));}}
 onPointerMove={event=>{if(dragging.current)setPreview(at(event.clientX));}}
 onPointerUp={event=>{if(!dragging.current)return;dragging.current=false;onChange?.(at(event.clientX));setPreview(null);}}
 onPointerCancel={()=>{dragging.current=false;setPreview(null);}}>
 {[1,2,3,4,5].map(rating=><label key={rating}>
 {onChange&&rating>1&&<input className={styles.halfRating} type="radio" name="guest-rating" aria-label={`${rating-.5} out of 5`} checked={value===rating-.5} disabled={disabled} onChange={()=>onChange(rating-.5)}/>}
 {onChange&&<input type="radio" name="guest-rating" aria-label={`${rating} out of 5`} checked={value===rating} disabled={disabled} onChange={()=>onChange(rating)}/>}
 <svg viewBox="0 0 24 24" aria-hidden="true" data-filled={rating<=shown}><defs><linearGradient id={`${gradientId}-${rating}`}><stop offset="50%" stopColor="#ebc4cb"/><stop offset="50%" stopColor="white"/></linearGradient></defs><path style={{fill:shown===rating-.5?`url(#${gradientId}-${rating})`:undefined}} d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9Z"/></svg>
 </label>)}
 </div>;
}
