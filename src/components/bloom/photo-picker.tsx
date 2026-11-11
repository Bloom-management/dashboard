'use client';
import {useRef,useState} from 'react';
import {Menu} from '@base-ui/react/menu';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent} from '../ui/dropdown-menu';
import styles from './photo-picker.module.css';

export function PhotoPicker({onFiles,label='Add photo',iconOnly=false}:{onFiles:(files:FileList|null)=>void;label?:string;iconOnly?:boolean}){
 const camera=useRef<HTMLInputElement>(null),gallery=useRef<HTMLInputElement>(null),files=useRef<HTMLInputElement>(null),container=useRef<HTMLDivElement>(null);
 const [open,setOpen]=useState(false);
 const selected=(input:HTMLInputElement)=>{onFiles(input.files);input.value='';};
 // Render in the dialog itself so clipped ancestors (e.g. the note box) cannot cut the menu off.
 const dialog=container.current?.closest('dialog')??undefined;
 return <div ref={container} className={styles.picker}>
 <DropdownMenu open={open} onOpenChange={setOpen}><DropdownMenuTrigger aria-label={label} title={iconOnly?label:undefined} className={iconOnly?styles.camera:styles.trigger}>{iconOnly?<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h4l2-3h4l2 3h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4"/></svg>:label}</DropdownMenuTrigger>
 <DropdownMenuContent container={dialog??container} collisionBoundary={dialog}>
 <Menu.Item className={styles.option} onClick={()=>camera.current?.click()}>Take photo</Menu.Item>
 <Menu.Item className={styles.option} onClick={()=>gallery.current?.click()}>Photo library</Menu.Item>
 <Menu.Item className={styles.option} onClick={()=>files.current?.click()}>Choose file</Menu.Item>
 </DropdownMenuContent></DropdownMenu>
 <input ref={camera} hidden type="file" accept="image/*" capture="environment" aria-label="Take photo" onChange={e=>selected(e.currentTarget)}/>
 <input ref={gallery} hidden type="file" accept="image/*" multiple aria-label="Photo library" onChange={e=>selected(e.currentTarget)}/>
 <input ref={files} hidden type="file" multiple aria-label="Choose file" onChange={e=>selected(e.currentTarget)}/>
 </div>;
}
