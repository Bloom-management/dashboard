'use client';
import type {ReactNode} from 'react';
import {ProviderLogo} from './provider-logo';
import {Select} from '../ui/select';
import {AddCard} from './add-card';
import type { CleaningConfig } from '../../contracts';
export function SupplyIcon(){return <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M9 3h6v4H9zM8 7h8l2 5v9H6v-9zM6 14h12"/></svg>;}
type SetupItem={id:string;name:string};
/** Editable card grid ending in an Add card; shared by the supply and maintenance setup steps. */
function ItemSetupGrid({legend,intro,label,placeholder,icon,items,onChange,disabled,required}:{legend:string;intro?:string;label:string;placeholder:string;icon:ReactNode;items:SetupItem[];onChange:(items:SetupItem[])=>void;disabled:boolean;required:boolean}){
 const noun=label.toLowerCase();
 return <fieldset disabled={disabled}><legend>{legend}</legend>{intro&&<p>{intro}</p>}<div className="owner-create-supply-grid">{items.map((item,index)=><div className="owner-room-count-card" key={item.id}>{icon}<label>{label} {index+1}<input aria-label={`${label} ${index+1}`} required={required} maxLength={100} placeholder={placeholder} value={item.name} onChange={event=>onChange(items.map(i=>i.id===item.id?{...i,name:event.target.value}:i))}/></label><button type="button" className="bloom-button secondary" aria-label={`Remove ${noun} ${index+1}`} onClick={()=>onChange(items.filter(i=>i.id!==item.id))}>Remove</button></div>)}<AddCard label={`Add ${noun}`} disabled={items.length>=100} onClick={()=>onChange([...items,{id:crypto.randomUUID(),name:''}])}/></div></fieldset>;
}
/** Shared by initial listing setup and persisted property settings. */
export function SupplySetupGrid({supplies,onChange,disabled=false,optional=false}:{supplies:CleaningConfig['supplies'];onChange:(supplies:CleaningConfig['supplies'])=>void;disabled?:boolean;optional?:boolean}){
 return <ItemSetupGrid legend="Supplies (optional)" intro={`Add the supplies cleaners should report. ${optional?'You can skip this and add them later in the Supplies tab.':'Save an empty list if this property needs no supply checklist.'}`} label="Supply" placeholder="e.g. Dish soap" icon={<SupplyIcon/>} items={supplies} onChange={onChange} disabled={disabled} required={!optional}/>;
}
export function MaintenanceIcon(){return <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6Z"/></svg>;}
/** The listing's own maintenance checks, in addition to Bloom's standard checklist. */
export function MaintenanceSetupGrid({items,onChange,disabled=false}:{items:SetupItem[];onChange:(items:SetupItem[])=>void;disabled?:boolean}){
 return <ItemSetupGrid legend="Maintenance (optional)" label="Maintenance check" placeholder="e.g. Dishwasher" icon={<MaintenanceIcon/>} items={items} onChange={onChange} disabled={disabled} required={false}/>;
}
export function CalendarSetupCard({provider,url,onProvider,onUrl,disabled=false,required=false,title,remove}:{provider:'airbnb'|'vrbo';url:string;onProvider:(provider:'airbnb'|'vrbo')=>void;onUrl:(url:string)=>void;disabled?:boolean;required?:boolean;title?:string;remove?:()=>void}){
 return <div className="owner-room-count-card owner-calendar-setup-card"><ProviderLogo provider={provider}/>{title&&<strong>{title}</strong>}<label>Calendar provider<Select disabled={disabled} value={provider} onChange={e=>onProvider(e.target.value as 'airbnb'|'vrbo')}><option value="airbnb">Airbnb</option><option value="vrbo">Vrbo</option></Select></label><label>Private {provider==='airbnb'?'Airbnb':'Vrbo'} iCal export link<input type="password" required={required} disabled={disabled} maxLength={4096} autoComplete="off" value={url} onChange={e=>onUrl(e.target.value)}/></label>{remove&&<button type="button" className="bloom-button secondary" disabled={disabled} aria-label={`Remove ${title?.toLowerCase()??'calendar'}`} onClick={remove}>Remove</button>}</div>;
}
