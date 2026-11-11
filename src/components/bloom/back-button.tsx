'use client';
import type {ReactNode} from 'react';
import styles from './back-button.module.css';

/** Standard "← Back to …" navigation: pink text and arrow, no fill. Matches the shared dialog back button. */
export function BackButton({onClick,children,disabled=false,className}:{onClick:()=>void;children:ReactNode;disabled?:boolean;className?:string}){
 return <button type="button" className={`${styles.back}${className?` ${className}`:''}`} disabled={disabled} onClick={onClick}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14"/></svg><span>{children}</span></button>;
}
