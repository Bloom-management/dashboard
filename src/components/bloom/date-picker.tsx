'use client';

import { useId, useRef } from 'react';
import { Calendar, calendarDate, calendarValue } from '../ui/calendar';
import { formatDate } from './dates';

export function DatePicker({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const details = useRef<HTMLDetailsElement>(null);
  const id = useId();
  return <div><span id={id}>{label}</span><details ref={details}>
    <summary className="bloom-button secondary" aria-describedby={id}>{value ? formatDate(value) : 'Select date'}</summary>
    <Calendar mode="single" required captionLayout="dropdown" selected={value ? calendarDate(value) : undefined} defaultMonth={value ? calendarDate(value) : undefined}
      onSelect={date => { if (date) { onChange(calendarValue(date)); if (details.current) { details.current.open = false; details.current.querySelector('summary')?.focus(); } } }} />
  </details></div>;
}
