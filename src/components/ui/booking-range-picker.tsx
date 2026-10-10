'use client';

import { useRef, useState } from 'react';
import { DayButton, type DayButtonProps } from 'react-day-picker';
import { Calendar, calendarDate, calendarValue } from './calendar';
import styles from './booking-range-picker.module.css';

export type BookingRange = { checkIn: string; checkout: string };
export type UnavailableNights = { startDate: string; endDate: string };
export function bookingRangeAvailable(start: string, end: string, unavailable: UnavailableNights[]) {
  return !!start && end > start && !unavailable.some(block => start < block.endDate && end > block.startDate);
}
export function bookingNights(start: string, end: string) {
  return start && end > start ? Math.round((calendarDate(end).getTime() - calendarDate(start).getTime()) / 86400000) : 0;
}
function RangeDay(props: DayButtonProps) { return <DayButton {...props} data-booking-date={calendarValue(props.day.date)} />; }
const components = { DayButton: RangeDay };

/** Calendar values are property-local date strings, never browser-local timestamps. */
export function BookingRangePicker({ value, onChange, unavailable, timezone, initialDate, disabled = false }: {
  value: BookingRange; onChange: (range: BookingRange) => void; unavailable: UnavailableNights[];
  timezone: string; initialDate: string; disabled?: boolean;
}) {
  const [month, setMonth] = useState(() => calendarDate(value.checkIn || initialDate));
  const [editing, setEditing] = useState<'checkIn' | 'checkout'>(value.checkIn && !value.checkout ? 'checkout' : 'checkIn');
  const [preview, setPreview] = useState<BookingRange | null>(null);
  const [error, setError] = useState('');
  const drag = useRef<{ start: string; end: string } | null>(null);
  const suppressClick = useRef(false);
  const occupied = (day: string) => unavailable.some(block => day >= block.startDate && day < block.endDate);
  const valid = (start: string, end: string) => bookingRangeAvailable(start, end, unavailable);
  const choose = (day: string) => {
    if (disabled) return;
    if (suppressClick.current) { suppressClick.current = false; return; }
    setError(''); setPreview(null);
    if (editing === 'checkout' && value.checkIn && day > value.checkIn) {
      if (!valid(value.checkIn, day)) { setError('These dates include an unavailable night. Choose checkout before the next stay.'); return; }
      onChange({ checkIn: value.checkIn, checkout: day }); setEditing('checkIn');
    } else if (!occupied(day)) {
      onChange({ checkIn: day, checkout: '' }); setEditing('checkout');
    } else setError('This night is unavailable. Choose another check-in date.');
  };
  const shown = preview || value;
  const nights = bookingNights(shown.checkIn, shown.checkout);
  const label = (date: string) => date ? calendarDate(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'Choose date';
  return <div className={styles.picker}>
    <div className={styles.fields}>{(['checkIn', 'checkout'] as const).map(field => <button type="button" key={field} disabled={disabled || (field === 'checkout' && !value.checkIn)} aria-pressed={editing === field} onClick={() => { setEditing(field); setError(''); if (value[field]) setMonth(calendarDate(value[field])); }}>
      <span>{field === 'checkIn' ? 'Check-in' : 'Checkout'}</span><strong>{label(value[field])}</strong>
    </button>)}</div>
    <div className={styles.surface} onPointerDown={event => {
      suppressClick.current = false;
      if (disabled || event.pointerType === 'touch' || event.button !== 0) return;
      const day = (event.target as HTMLElement).closest<HTMLElement>('[data-booking-date]')?.dataset.bookingDate;
      if (day && !occupied(day)) drag.current = { start: day, end: day };
    }} onPointerMove={event => {
      if (!drag.current || !event.buttons) return;
      const day = (event.target as HTMLElement).closest<HTMLElement>('[data-booking-date]')?.dataset.bookingDate;
      if (day) { drag.current.end = day; const [start, end] = [drag.current.start, day].sort(); setPreview(valid(start, end) ? { checkIn: start, checkout: end } : null); }
    }} onPointerUp={() => {
      const range = drag.current; drag.current = null; setPreview(null);
      if (!range || range.start === range.end) return;
      suppressClick.current = true;
      // A cross-cell drag may dispatch its click on the grid rather than a day.
      // Suppress only this pointer gesture, never the next keyboard selection.
      window.setTimeout(() => { suppressClick.current = false; }, 0);
      const [start, end] = [range.start, range.end].sort();
      if (valid(start, end)) { onChange({ checkIn: start, checkout: end }); setEditing('checkIn'); setError(''); }
      else setError('These dates include an unavailable night. Choose a continuous available stay.');
    }} onPointerLeave={() => { drag.current = null; setPreview(null); }} onPointerCancel={() => { drag.current = null; setPreview(null); }}>
      <Calendar mode="range" captionLayout="dropdown" month={month} onMonthChange={setMonth}
        onSelect={() => { /* Keep DayPicker controlled; choose() validates exclusive checkout. */ }}
        selected={shown.checkIn ? { from: calendarDate(shown.checkIn), to: shown.checkout ? calendarDate(shown.checkout) : undefined } : undefined}
        components={components} onDayClick={day => choose(calendarValue(day))}
        onDayMouseEnter={day => { const end = calendarValue(day); if (!drag.current && editing === 'checkout' && value.checkIn) setPreview(valid(value.checkIn, end) ? { checkIn: value.checkIn, checkout: end } : null); }}
        disabled={disabled} modifiers={{ unavailable: date => occupied(calendarValue(date)) }} modifiersClassNames={{ unavailable: styles.unavailable }}
        labels={{ labelDayButton: date => `${label(calendarValue(date))}${occupied(calendarValue(date)) ? ', unavailable night; checkout allowed if the preceding nights are available' : ', available night'}` }} />
    </div>
    <p className={styles.preview} aria-live="polite">{nights ? `${label(shown.checkIn)} – ${label(shown.checkout)} · ${nights} ${nights === 1 ? 'night' : 'nights'}` : value.checkIn ? 'Choose checkout to complete your stay.' : 'Choose check-in, then checkout.'}</p>
    <p className={styles.help}><span className={styles.legend}>Unavailable night</span> · Checkout does not occupy a night. Dates in {timezone}.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}
