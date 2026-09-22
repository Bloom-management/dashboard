'use client';

import { Menu } from '@base-ui/react/menu';
import type { ComponentProps } from 'react';
import styles from './dropdown-menu.module.css';
import choice from './choice-card.module.css';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export function DropdownMenuRadioGroup({className,...props}:ComponentProps<typeof Menu.RadioGroup>) { return <Menu.RadioGroup {...props} className={`${choice.group} ${className??''}`}/>; }

export function DropdownMenuContent({ className, container, keepBelow = false, ...props }: ComponentProps<typeof Menu.Popup> & { container?: ComponentProps<typeof Menu.Portal>['container']; keepBelow?: boolean }) {
  return <Menu.Portal container={container ?? undefined}><Menu.Positioner side="bottom" collisionAvoidance={keepBelow?{side:'none',align:'shift',fallbackAxisSide:'none'}:undefined} align="start" sideOffset={8} className={styles.positioner}>
    <Menu.Popup className={`${styles.content} ${className ?? ''}`} {...props} />
  </Menu.Positioner></Menu.Portal>;
}

export function DropdownMenuRadioItem({ children, className, ...props }: ComponentProps<typeof Menu.RadioItem>) {
  return <Menu.RadioItem closeOnClick {...props} className={`${choice.card} ${className??''}`}>
    <span className={choice.label}>{children}</span>
    <span className={choice.indicator} aria-hidden="true"><Menu.RadioItemIndicator><span className={choice.dot}/></Menu.RadioItemIndicator></span>
  </Menu.RadioItem>;
}
