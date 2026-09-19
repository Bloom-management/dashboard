import type { ComponentProps } from 'react';
import styles from './dropdown-menu.module.css';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={`${styles.input} ${className ?? ''}`} {...props} />;
}
