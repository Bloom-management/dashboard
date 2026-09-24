import type {ComponentProps} from 'react';
import styles from './outline-button.module.css';
/** Outlined secondary action; existing primary and pill buttons keep their styling. */
export function OutlineButton({className='',type='button',...props}:ComponentProps<'button'>){return <button {...props} type={type} className={`${styles.button} ${className}`}/>;}
