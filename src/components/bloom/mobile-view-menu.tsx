'use client';
import {DropdownMenu,DropdownMenuContent,DropdownMenuRadioGroup,DropdownMenuRadioItem,DropdownMenuTrigger} from '../ui/dropdown-menu';
import {navigationLabel} from './navigation-labels';
export function MobileViewMenu({value,values,onChange,label}:{value:string;values:readonly string[];onChange:(value:string)=>void;label:string}) {
 return <nav className="bloom-mobile-view-menu" aria-label={label}><DropdownMenu><DropdownMenuTrigger className="bloom-hub-trigger" aria-label={`${label}: ${navigationLabel(value)}`}>{navigationLabel(value)}<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuRadioGroup value={value} onValueChange={onChange} aria-label={label}>{values.map(view=><DropdownMenuRadioItem key={view} value={view} label={navigationLabel(view)}>{navigationLabel(view)}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu></nav>;
}
