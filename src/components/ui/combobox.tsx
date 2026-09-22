'use client';
import { Combobox as Base } from '@base-ui/react/combobox';
import type { ComponentProps } from 'react';
import styles from './combobox.module.css';
import choice from './choice-card.module.css';
export const Combobox=Base.Root;
export const ComboboxValue=Base.Value;
export function ComboboxChips(props:ComponentProps<typeof Base.Chips>) {return <Base.Chips {...props} className={styles.chips}/>;}
export function ComboboxChip({children,...props}:ComponentProps<typeof Base.Chip>) {return <Base.Chip {...props} className={styles.chip}><span className={styles.chipLabel}>{children}</span><Base.ChipRemove aria-label={`Remove ${children}`} className={styles.remove}>×</Base.ChipRemove></Base.Chip>;}
export const ComboboxCollection=Base.Collection;
export const ComboboxGroup=Base.Group;
export const ComboboxList=Base.List;
export function ComboboxLabel(props:ComponentProps<typeof Base.GroupLabel>) {return <Base.GroupLabel {...props} className={styles.label}/>;}
export function ComboboxSeparator(props:ComponentProps<typeof Base.Separator>) {return <Base.Separator {...props} className={styles.separator} data-city-separator/>;}
export function ComboboxInput({showClear=false,hasSelection=false,children,...props}:ComponentProps<typeof Base.Input>&{showClear?:boolean;hasSelection?:boolean}) {
 return <Base.InputGroup className={`${styles.inputGroup} ${children?styles.withChips:''}`}>{children}<Base.Input {...props} className={styles.input}/>{showClear&&hasSelection?<Base.Clear className={styles.icon} aria-label="Clear selected units"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></Base.Clear>:<Base.Trigger className={styles.icon} aria-label="Show units"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></Base.Trigger>}</Base.InputGroup>;
}
export function ComboboxContent({children}:ComponentProps<typeof Base.Popup>) {
 return <Base.Portal><Base.Positioner sideOffset={6} className={styles.positioner}><Base.Popup className={styles.popup}>{children}</Base.Popup></Base.Positioner></Base.Portal>;
}
export function ComboboxEmpty({children}:ComponentProps<typeof Base.Empty>) {return <Base.Empty className={styles.empty}>{children}</Base.Empty>;}
export function ComboboxItem({children,...props}:ComponentProps<typeof Base.Item>) {return <Base.Item {...props} className={`${choice.card} ${choice.listCard}`}><span className={choice.label}>{children}</span><span className={`${choice.indicator} ${choice.checkbox}`} aria-hidden="true"><Base.ItemIndicator>✓</Base.ItemIndicator></span></Base.Item>;}
