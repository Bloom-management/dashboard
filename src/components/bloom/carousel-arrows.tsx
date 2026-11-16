'use client';
import {Icon} from './primitives';

/** Shared previous/next pair beside a SelectorPill: white round icon buttons with centred SVG arrows. */
export function CarouselArrows({label,onPrevious,onNext,previousDisabled=false,nextDisabled=false}:{label:string;onPrevious:()=>void;onNext:()=>void;previousDisabled?:boolean;nextDisabled?:boolean}){
 return <div className="owner-carousel-controls"><button type="button" className="icon-btn" aria-label={`Previous ${label}`} disabled={previousDisabled} onClick={onPrevious}><Icon name="left"/></button><button type="button" className="icon-btn" aria-label={`Next ${label}`} disabled={nextDisabled} onClick={onNext}><Icon name="right"/></button></div>;
}
