'use client';

import { useEffect, useRef, useState } from 'react';
import {Modal} from './primitives';
import choice from '../ui/choice-card.module.css';
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
  const [open,setOpen]=useState(false);
  const [search,setSearch]=useState('');
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(open)input.current?.focus();},[open]);
  const selected=locations.find(location=>location.id===value);
  const filtered=locations.filter(location=>location.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <>
    <button type="button" className={styles.trigger} disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-invalid={ariaInvalid} aria-describedby={describedBy} aria-label={`${label}: ${selected?.name??placeholder}`} onClick={()=>{setSearch('');setOpen(true);}}>
      <span>{selected?.name??placeholder}</span><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </button>
    {open&&<Modal title={label} className={styles.dialog} onClose={()=>setOpen(false)}>
      <h2 className={styles.heading}>{label}</h2>
      <div className={styles.search}><Input ref={input} aria-label={searchLabel} placeholder={`${searchLabel}…`} value={search} onChange={event=>setSearch(event.target.value)}/></div>
      <div className={`${styles.options} ${choice.group}`} role="group" aria-label={label}>
        {filtered.map(location=><button type="button" className={choice.card} key={location.id} aria-pressed={location.id===value} data-selected={location.id===value?'':undefined} onClick={()=>{onValueChange(location.id);setOpen(false);}}><span className={choice.label}>{location.name}</span><span className={choice.indicator} aria-hidden="true">{location.id===value&&<span className={choice.dot}/>}</span></button>)}
        {!filtered.length&&<p className={styles.empty} role="status">{locations.length?'No locations found.':'No locations available.'}</p>}
      </div>
    </Modal>}
  </>;
}
