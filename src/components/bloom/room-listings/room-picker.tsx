'use client';
import {useId,useRef,useState} from 'react';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuRadioGroup,DropdownMenuRadioItem} from '../../ui/dropdown-menu';
import styles from './room-picker.module.css';

/** Room navigation uses Bloom's anchored menu; operational form fields keep Select. */
export function RoomPicker({rooms,value,onChange,shared=false,disabled=false}:{rooms:readonly {propertyId:string;identifier:string}[];value:string;onChange:(value:string)=>void;shared?:boolean;disabled?:boolean}){
 const [open,setOpen]=useState(false),trigger=useRef<HTMLButtonElement>(null),label=useId();
 const options=[...rooms.map(r=>({value:r.propertyId,label:r.identifier})),...(shared?[{value:'shared',label:'Shared spaces'}]:[])];
 const selected=options.find(o=>o.value===value)??options[0];
 const dialog=trigger.current?.closest('dialog')??undefined;
 return <div className={styles.picker}><span id={label}>Room</span><DropdownMenu open={open} onOpenChange={setOpen}>
  <DropdownMenuTrigger ref={trigger} className={styles.trigger} disabled={disabled} aria-label={`Room: ${selected?.label??'Choose room'}`}><span>{selected?.label??'Choose room'}</span><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></DropdownMenuTrigger>
  <DropdownMenuContent container={dialog} collisionBoundary={dialog} className={styles.popup} aria-labelledby={label}>
   <DropdownMenuRadioGroup value={selected?.value??''} onValueChange={onChange}>{options.map(o=><DropdownMenuRadioItem key={o.value} value={o.value} className={styles.option}>{o.label}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup>
  </DropdownMenuContent>
 </DropdownMenu></div>;
}
