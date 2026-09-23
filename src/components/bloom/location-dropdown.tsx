'use client';

import { useRef, useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Input } from '../ui/input';
import styles from './location-dropdown.module.css';

export function LocationDropdown({ locations, value, onValueChange, label, placeholder = 'Choose city', disabled = false, searchLabel = 'Search locations', ariaInvalid, describedBy }: {
  locations: readonly { id: string; name: string }[];
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  searchLabel?: string;
  ariaInvalid?: boolean;
  describedBy?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [container,setContainer]=useState<HTMLElement|null>(null);
  const [search, setSearch] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const options = useRef<HTMLDivElement>(null);
  const selected = locations.find(location => location.id === value);
  const filtered = locations.filter(location => location.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <DropdownMenu onOpenChange={open => { if (open) { setSearch(''); setContainer(trigger.current?.closest('dialog')??null); } }} onOpenChangeComplete={open => { if (open && !options.current?.contains(document.activeElement)) input.current?.focus(); }}>
    <DropdownMenuTrigger ref={trigger} className={styles.trigger} disabled={disabled} aria-invalid={ariaInvalid} aria-describedby={describedBy} aria-label={`${label}: ${selected?.name ?? placeholder}`}>
      <span>{selected?.name ?? placeholder}</span><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </DropdownMenuTrigger>
    <DropdownMenuContent container={container} keepBelow>
      <div className={styles.search}><Input ref={input} aria-label={searchLabel} placeholder={`${searchLabel}…`} value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); event.stopPropagation();
          const items = options.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
          (event.key === 'ArrowDown' ? items?.[0] : items?.[items.length - 1])?.focus();
        } else if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
      }} /></div>
      <div ref={options} className={styles.options}>
        <DropdownMenuRadioGroup value={value} onValueChange={onValueChange} aria-label={label}>
          {filtered.map(location => <DropdownMenuRadioItem key={location.id} value={location.id} label={location.name}>{location.name}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        {!filtered.length && <p className={styles.empty} role="status">{locations.length ? 'No locations found.' : 'No locations available.'}</p>}
      </div>
    </DropdownMenuContent>
  </DropdownMenu>;
}
