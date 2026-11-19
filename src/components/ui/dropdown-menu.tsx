'use client';

import { Menu } from '@base-ui/react/menu';
import type { ComponentProps } from 'react';
import styles from './dropdown-menu.module.css';
import choice from './choice-card.module.css';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export function DropdownMenuRadioGroup({className,...props}:ComponentProps<typeof Menu.RadioGroup>) { return <Menu.RadioGroup {...props} className={`${choice.group} ${className??''}`}/>; }

export function DropdownMenuContent({ className, container, collisionBoundary, keepBelow = false, ...props }: ComponentProps<typeof Menu.Popup> & { container?: ComponentProps<typeof Menu.Portal>['container']; keepBelow?: boolean; collisionBoundary?: ComponentProps<typeof Menu.Positioner>['collisionBoundary'] }) {
  return <Menu.Portal container={container ?? undefined}><Menu.Positioner collisionBoundary={collisionBoundary} collisionPadding={12} side="bottom" collisionAvoidance={keepBelow?{side:'none',align:'shift',fallbackAxisSide:'none'}:undefined} align="start" sideOffset={8} className={styles.positioner}>
    <Menu.Popup className={`${styles.content} ${className ?? ''}`} {...props} />
  </Menu.Positioner></Menu.Portal>;
}

export function DropdownMenuRadioItem({ children, className, ...props }: ComponentProps<typeof Menu.RadioItem>) {
  return <Menu.RadioItem closeOnClick {...props} className={`${choice.card} ${className??''}`}>
    <span className={choice.label}>{children}</span>
    <span className={`${choice.indicator} ${choice.radioIndicator}`} aria-hidden="true"><Menu.RadioItemIndicator><span className={choice.dot}/></Menu.RadioItemIndicator></span>
  </Menu.RadioItem>;
}

/** Card-styled group for action items (same layout as radio groups). */
export function DropdownMenuGroup({className,...props}:ComponentProps<typeof Menu.Group>) { return <Menu.Group {...props} className={`${choice.group} ${className??''}`}/>; }

/** Action item: runs onClick and closes the menu. Same card styling as radio items, without an indicator. */
export function DropdownMenuItem({ children, className, ...props }: ComponentProps<typeof Menu.Item>) {
  return <Menu.Item {...props} className={`${choice.card} ${className??''}`}><span className={choice.label}>{children}</span></Menu.Item>;
}
