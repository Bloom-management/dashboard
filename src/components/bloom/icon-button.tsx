'use client';
import type {ButtonHTMLAttributes} from 'react';
import {Icon,type IconName} from './primitives';
import styles from './icon-button.module.css';

/**
 * The one way to build an icon-only button (close ×, previous ‹, next ›, remove).
 * Square/circle box with the SVG icon centred by grid, no padding and no line-height,
 * so it is centred regardless of font, global button styles or parent layout.
 */
export function IconButton({icon,label,size='md',variant='soft',iconSize,className,...props}:{icon:IconName;label:string;size?:'sm'|'md'|'lg';variant?:'soft'|'plain'|'outline';iconSize?:number}&Omit<ButtonHTMLAttributes<HTMLButtonElement>,'children'|'aria-label'>){
 return <button type="button" {...props} aria-label={label} className={`${styles.button}${className?` ${className}`:''}`} data-size={size} data-variant={variant}><Icon name={icon} size={iconSize??(size==='sm'?14:size==='lg'?20:18)}/></button>;
}
