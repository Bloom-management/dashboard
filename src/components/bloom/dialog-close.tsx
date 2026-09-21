'use client';
import styles from './dialog-close.module.css';
/** Standard close control for every Bloom dialog. Keep it a direct dialog child. */
export function DialogClose({onClose,label='Close details',disabled=false,autoFocus=false}:{onClose:()=>void;label?:string;disabled?:boolean;autoFocus?:boolean}){
 return <button type="button" className={styles.close} data-bloom-dialog-close aria-label={label} disabled={disabled} autoFocus={autoFocus} onClick={onClose}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>;
}
