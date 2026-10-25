'use client';

import { useId, useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import styles from './date-picker.module.css';
import { Calendar, calendarDate, calendarValue } from '../ui/calendar';
import { formatDate } from './dates';

export function DatePicker({ value, onChange, label, variant = 'default' }: { value: string; onChange: (value: string) => void; label: string; variant?: 'default' | 'popover' }) {
  const details = useRef<HTMLDetailsElement>(null);
  const id = useId();
  const [open,setOpen]=useState(false);
  const container=useRef<HTMLDivElement>(null);
  if(variant==='popover')return <div ref={container} className={styles.field}><label htmlFor={id}>{label}</label><Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger id={id} className={styles.trigger}>{value?formatDate(value):'Pick a date'}</Popover.Trigger>
    <Popover.Portal container={container}><Popover.Positioner sideOffset={8} align="start" collisionPadding={12} className={styles.positioner}><Popover.Popup className={styles.popup}>
      <Calendar mode="single" required captionLayout="dropdown" selected={value?calendarDate(value):undefined} defaultMonth={value?calendarDate(value):undefined}
        onSelect={date=>{if(date){onChange(calendarValue(date));setOpen(false);}}}/>
    </Popover.Popup></Popover.Positioner></Popover.Portal>
  </Popover.Root></div>;
  return <div><span id={id}>{label}</span><details ref={details}>
    <summary className="bloom-button secondary" aria-describedby={id}>{value ? formatDate(value) : 'Select date'}</summary>
    <Calendar mode="single" required captionLayout="dropdown" selected={value ? calendarDate(value) : undefined} defaultMonth={value ? calendarDate(value) : undefined}
      onSelect={date => { if (date) { onChange(calendarValue(date)); if (details.current) { details.current.open = false; details.current.querySelector('summary')?.focus(); } } }} />
  </details></div>;
}
