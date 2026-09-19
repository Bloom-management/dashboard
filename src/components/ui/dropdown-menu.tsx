'use client';

import { Menu } from '@base-ui/react/menu';
import type { ComponentProps } from 'react';
import styles from './dropdown-menu.module.css';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuRadioGroup = Menu.RadioGroup;

export function DropdownMenuContent({ className, container, keepBelow = false, ...props }: ComponentProps<typeof Menu.Popup> & { container?: ComponentProps<typeof Menu.Portal>['container']; keepBelow?: boolean }) {
  return <Menu.Portal container={container}><Menu.Positioner side="bottom" collisionAvoidance={keepBelow?{side:'none',align:'shift',fallbackAxisSide:'none'}:undefined} align="start" sideOffset={8} className={styles.positioner}>
    <Menu.Popup className={`${styles.content} ${className ?? ''}`} {...props} />
  </Menu.Positioner></Menu.Portal>;
}

export function DropdownMenuRadioItem({ children, ...props }: ComponentProps<typeof Menu.RadioItem>) {
  return <Menu.RadioItem className={styles.item} closeOnClick {...props}>
    <span className={styles.indicator}><Menu.RadioItemIndicator>✓</Menu.RadioItemIndicator></span>
    <span className={styles.label}>{children}</span>
  </Menu.RadioItem>;
}
