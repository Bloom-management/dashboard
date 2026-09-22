'use client';

import { DialogClose } from './dialog-close';
import { lockDialogScroll } from './dialog-scroll';
import { useRouter } from 'next/navigation';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { InlineChange, Role, SessionUser } from '../../contracts';
import { api, ApiError } from './api';
import { shiftMonth, todayIn } from './dates';
import { BookingCalendar, Calendar, calendarDate, calendarValue } from '../ui/calendar';
import { rolePath } from './integration';
import { requestStateKind } from './request-state';
import { RequestState } from './request-state-view';
import { BloomSessionRecovery } from './sign-in-layout';

export function useResource<T>(loader: (signal: AbortSignal) => Promise<T>, preserveWhileChecking = false) {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setState(previous => preserveWhileChecking && previous.data !== undefined ? previous : { loading: true });
    loader(controller.signal).then(data => { if (!controller.signal.aborted) setState({ data, loading: false }); })
      .catch(error => { if (!controller.signal.aborted) setState({ error, loading: false }); });
    return () => controller.abort();
  }, [loader, revision, preserveWhileChecking]);
  return { ...state, reload };
}

export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  return <RequestState kind={requestStateKind(error instanceof ApiError ? error.code : undefined)}
    message={error instanceof ApiError ? error.message : undefined}
    requestId={error instanceof ApiError ? error.requestId : undefined} retry={retry} />;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="cal-empty"><h2 className="cal-empty-title">{title}</h2><div className="cal-empty-sub">{children}</div></div>;
}
export function Loading() { return <p className="bloom-notice" role="status">Loading…</p>; }
export function Changes({ changes }: { changes: InlineChange[] }) {
  return <>{changes.map(change => <p className="bloom-notice" key={change.id}><strong>{change.type === 'removed' ? 'Removed from source' : change.type === 'conflict' ? 'Booking conflict' : 'Booking changed'}</strong><br />{change.message}</p>)}</>;
}
export function Icon({ name, size = 18 }: { name: 'grid' | 'list' | 'left' | 'right' | 'close' | 'plus' | 'pin'; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{
    name === 'grid' ? <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" /> :
    name === 'list' ? <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /> :
    name === 'pin' ? <><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></> :
    <path d={{ left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6', close: 'M6 6l12 12M18 6L6 18', plus: 'M12 5v14M5 12h14' }[name]} />
  }</svg>;
}
export function Brand({ role }: { role: Role }) {
  return <div className="brand"><svg className="brand-logo" width="34" height="34" viewBox="0 0 40 40" aria-hidden="true"><g transform="translate(20 20)">
    <ellipse cx="0" cy="-10" rx="6" ry="9" fill="#f0c4cb" /><ellipse cx="9.5" cy="-3.1" rx="6" ry="9" fill="#e89ba9" transform="rotate(72)" /><ellipse cx="5.9" cy="8.1" rx="6" ry="9" fill="#d97a85" transform="rotate(144)" /><ellipse cx="-5.9" cy="8.1" rx="6" ry="9" fill="#e89ba9" transform="rotate(216)" /><ellipse cx="-9.5" cy="-3.1" rx="6" ry="9" fill="#f0c4cb" transform="rotate(288)" /><circle cx="0" cy="0" r="3.5" fill="#2d2a1f" />
  </g></svg><div className="brand-text"><span className="brand-name">Bloom</span><span className="brand-sub">{role === 'cleaner' ? 'Cleaner' : role === 'owner' ? 'Owner' : 'Admin'} Hub</span></div></div>;
}
export function Account({ user }: { user: SessionUser }) {
  return <div className="me-chip" aria-label={`Signed in as ${user.displayName}`}><span className="bloom-initial" aria-hidden="true">{user.displayName.slice(0, 1)}</span><span>{user.displayName}</span></div>;
}
/** Presentation gate only: every endpoint must still enforce database roles and RLS. */
export function RoleGate({ role, children }: { role: Role; children: (user: SessionUser, refresh: () => void) => ReactNode }) {
  const load = useCallback((signal: AbortSignal) => api.me(signal), []);
  const session = useResource(load, true);
  useEffect(() => {
    const refresh = () => session.reload();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [session.reload]);
  if (session.loading) return <div className="main-inner"><Loading /></div>;
  if (session.error instanceof ApiError && session.error.code === 'UNAUTHENTICATED') return <BloomSessionRecovery requestId={session.error.requestId} retry={session.reload} />;
  if (session.error) return <div className="main-inner"><ErrorNotice error={session.error} retry={session.reload} /></div>;
  if (!session.data || (session.data.role !== role && !((role === 'cleaner' || role === 'owner') && session.data.role === 'admin'))) return <div className="main-inner"><RequestState kind="denied" />{session.data && <a className="bloom-button secondary" href={rolePath[session.data.role]}>Go to your hub</a>}</div>;
  return children(session.data, session.reload);
}
export function PropertyRail({ properties, selected, onSelect }: { properties: { id: string; name: string }[]; selected: string; onSelect: (id: string) => void }) {
  const [open,setOpen]=useState(false);
  const [search,setSearch]=useState('');
  const remaining=Math.max(0,properties.length-4);
  const hiddenSelected=properties.slice(4).some(property=>property.id===selected);
  const units=[{id:'',name:'All properties'},...properties];
  return <><aside className="rail" aria-label="Property filters"><div className="rail-label">Properties</div><div className="rail-list">{[{ id: '', name: 'All properties' }, ...properties.slice(0,4)].map(property => <button key={property.id} className={`rail-item${selected === property.id ? ' active' : ''}`} aria-label={property.name} aria-pressed={selected === property.id} title={property.name} onClick={() => onSelect(property.id)}><Icon name={property.id ? 'pin' : 'grid'} /><span className="rail-tip">{property.name}</span></button>)}{remaining>0&&<button type="button" className={`rail-item rail-more${hiddenSelected?' active':''}`} aria-label={`Show all units, ${remaining} more listings`} aria-haspopup="dialog" aria-expanded={open} onClick={()=>{setSearch('');setOpen(true);}}>+{remaining}</button>}</div></aside>{open&&<Modal className="cleaner-day-dialog property-rail-dialog" title="All units" onClose={()=>setOpen(false)}><header><h2>All units</h2><p>Choose a unit to filter the calendar.</p></header><label className="property-rail-search">Search units<input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search by name"/></label><ul className="property-rail-units">{units.filter(unit=>unit.name.toLowerCase().includes(search.trim().toLowerCase())).map(unit=><li key={unit.id}><button type="button" aria-pressed={selected===unit.id} onClick={()=>{onSelect(unit.id);setOpen(false);}}><Icon name={unit.id?'pin':'grid'}/><span>{unit.name}</span>{selected===unit.id&&<span aria-hidden="true">✓</span>}</button></li>)}</ul>{!units.some(unit=>unit.name.toLowerCase().includes(search.trim().toLowerCase()))&&<p>No matching units.</p>}</Modal>}</>;

}
export function MonthHead({ month, onMonth, owner = false, onDaySelect }: { month: string; onMonth: (month: string) => void; owner?: boolean; onDaySelect?: (date:string)=>void }) {
  const [open, setOpen] = useState(false);
  const picker=useRef<HTMLDivElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:Event)=>{if(event.target instanceof Node&&!picker.current?.contains(event.target)&&!trigger.current?.contains(event.target))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setOpen(false);trigger.current?.focus();}};
    document.addEventListener('pointerdown',outside,true);document.addEventListener('click',outside,true);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('click',outside,true);document.removeEventListener('keydown',escape);};
  },[open]);
  return <div className={owner ? 'o-cal-head' : 'cal-head'}><div className="month-select"><button ref={trigger} type="button" className="month-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${month}-01T12:00:00Z`))}<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}><path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>{open && <div className="month-menu" ref={picker}><Calendar mode="single" captionLayout="dropdown" defaultMonth={calendarDate(month)} selected={calendarDate(month)} onSelect={date => { if (date) { onMonth(calendarValue(date).slice(0, 7)); setOpen(false); onDaySelect?.(calendarValue(date)); } }} onMonthChange={date => onMonth(calendarValue(date).slice(0, 7))} /></div>}</div><div className="cal-nav"><button type="button" className="bloom-button secondary" onClick={() => { setOpen(false); onMonth(todayIn('America/Detroit').slice(0, 7)); }}>Today</button><button className="icon-btn" aria-label="Previous month" onClick={() => onMonth(shiftMonth(month, -1))}><Icon name="left" /></button><button className="icon-btn" aria-label="Next month" onClick={() => onMonth(shiftMonth(month, 1))}><Icon name="right" /></button></div></div>;
}
export function CalendarGrid({ month, today, children, onDaySelect }: { month: string; today?: string; owner?: boolean; onDaySelect?: (date:string)=>void; children: (date: string) => ReactNode }) {
  return <BookingCalendar month={month} today={today} onDaySelect={onDaySelect}>{children}</BookingCalendar>;
}
export function Modal({ title, onClose, children, className = 'detail-card' }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const unlock = lockDialogScroll();
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); unlock(); previous?.focus({preventScroll:true}); };
  }, []);
  return <dialog ref={dialog} className={`bloom-dialog ${className}`} aria-labelledby={id} onCancel={event => { event.preventDefault(); event.stopPropagation(); close.current(); }} onClick={event => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close.current(); } }}><h2 id={id} className="bloom-sr-only">{title}</h2><DialogClose autoFocus onClose={onClose}/>{children}</dialog>;
}

/** Navigation changes the view only; the server-provided account role is unchanged. */
export function HubSelector({ user, view }: { user: SessionUser; view: 'admin' | 'cleaner' | 'owner' }) {
  const router=useRouter();
  if (user.role !== 'admin') return null;
  const hubs=[{id:'admin',label:'Admin Hub'},{id:'cleaner',label:'Cleaner Hub'},{id:'owner',label:'Owner Hub'}];
  return <nav className="bloom-hub-selector" aria-label="Hub view"><DropdownMenu><DropdownMenuTrigger className="bloom-hub-trigger" aria-label="Switch hub">{hubs.find(hub=>hub.id===view)?.label}<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuRadioGroup value={view} onValueChange={value=>{if(value!==view&&hubs.some(hub=>hub.id===value))router.push(`/${value}`);}} aria-label="Hub view">{hubs.map(hub=><DropdownMenuRadioItem key={hub.id} value={hub.id} label={hub.label}>{hub.label}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu></nav>;
}
