'use client';

import { DayPicker, type DayProps } from 'react-day-picker';
import type { ComponentProps, ReactNode } from 'react';
import styles from './calendar.module.css';
import { todayIn } from '../bloom/dates';

/** Date-only values use UTC throughout; property-local dates come from the API. */
export function calendarDate(value: string) { return new Date(`${value.length === 7 ? `${value}-01` : value}T12:00:00Z`); }
export function calendarValue(date: Date) { return date.toISOString().slice(0, 10); }

export function Calendar({ className, classNames, ...props }: ComponentProps<typeof DayPicker>) {
  const currentYear = new Date().getUTCFullYear();
  return <DayPicker timeZone="UTC" weekStartsOn={0} showOutsideDays fixedWeeks startMonth={calendarDate(`${currentYear - 2}-01`)} endMonth={calendarDate(`${currentYear + 2}-12`)}
    className={`${styles.calendar} ${(props.numberOfMonths??1)>1?styles.multipleMonths:''} ${className ?? ''}`}
    classNames={{ root: styles.root, months: styles.months, month: styles.month,
      nav: styles.nav, button_previous: styles.navButton, button_next: styles.navButton,
      month_caption: styles.caption, caption_label: styles.captionLabel,
      dropdowns: styles.dropdowns, dropdown_root: styles.dropdownRoot, dropdown: styles.dropdown,
      month_grid: styles.grid, weekdays: styles.weekdays, weekday: styles.weekday,
      week: styles.week, day: styles.day, day_button: styles.dayButton,
      today: styles.today, selected: styles.selected, outside: styles.outside,
      range_start: styles.rangeStart, range_end: styles.rangeEnd, range_middle: styles.rangeMiddle,
      disabled: styles.disabled, hidden: styles.hidden, chevron: styles.chevron, ...classNames }}
    {...props} />;
}

export function BookingCalendar({ month, today = todayIn('America/Detroit'), children, connected = false, onDaySelect }: { month: string; today?: string; connected?: boolean; onDaySelect?: (date:string)=>void; children: (date: string) => ReactNode }) {
  // Stable cell sizing and a scrollable event area keep long names from resizing columns.
  function BookingDay({ day, modifiers, ...props }: DayProps) {
    const value = calendarValue(day.date);
    return <td {...props} data-current-date={value === today || undefined}><div className={`${styles.bookingCell} ${onDaySelect?styles.selectableCell:''}`}>
      {onDaySelect&&!modifiers.outside&&<button type="button" className={styles.dayExpand} data-calendar-date={value} aria-label={`View jobs for ${value}`} onClick={()=>onDaySelect(value)}/>}
      <span className={`${styles.dateNumber} ${value === today ? styles.currentDate : ''}`} aria-current={value === today ? 'date' : undefined}>{day.date.getUTCDate()}</span>
      {!modifiers.outside && <div className={styles.events}>{children(value)}</div>}
    </div></td>;
  }
  return <Calendar month={calendarDate(month)} today={today ? calendarDate(today) : undefined} disableNavigation hideNavigation
    className={`${styles.bookings} ${connected ? styles.connected : ''}`} classNames={{ month_caption: styles.hidden }} components={{ Day: BookingDay }} />;
}
