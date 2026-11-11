'use client';
import {Drawer as Base} from '@base-ui/react/drawer';
import type {ComponentProps, ReactNode} from 'react';
import {Icon} from '../bloom/primitives';
import styles from './drawer.module.css';

/**
 * Bottom sheet built on Base UI Drawer, styled for Bloom (white surface, swipe handle, rounded top).
 * Usage: <Drawer open onOpenChange><DrawerContent title="Filters" footer={…}>…</DrawerContent></Drawer>
 */
export function Drawer(props:ComponentProps<typeof Base.Root>){return <Base.Root swipeDirection="down" {...props}/>;}
export const DrawerTrigger=Base.Trigger;
export const DrawerClose=Base.Close;

/** `container` keeps the sheet inside the app root so app fonts and component styles apply. */
export function DrawerContent({title,description,footer,children,container}:{title:string;description?:string;footer?:ReactNode;children:ReactNode;container?:HTMLElement|null}){
 return <Base.Portal container={container??undefined}><Base.Backdrop className={styles.backdrop}/><Base.Viewport className={styles.viewport}><Base.Popup className={styles.popup}>
  <div className={styles.handle} aria-hidden="true"/>
  <header className={styles.header}><Base.Title className={styles.title}>{title}</Base.Title><Base.Close className={styles.close} aria-label={`Close ${title.toLowerCase()}`}><Icon name="close" size={22}/></Base.Close></header>
  {description&&<Base.Description className={styles.description}>{description}</Base.Description>}
  <Base.Content className={styles.body}>{children}</Base.Content>
  {footer&&<footer className={styles.footer}>{footer}</footer>}
 </Base.Popup></Base.Viewport></Base.Portal>;
}
