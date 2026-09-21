'use client';
import { CalendarSetupCard } from './supply-setup-grid';
export type CalendarDraft={id:string;provider:'airbnb'|'vrbo';url:string};
export const initialCalendars=():CalendarDraft[]=>[{id:'airbnb',provider:'airbnb',url:''},{id:'vrbo',provider:'vrbo',url:''}];
export function CalendarSetupSection({calendars,onChange,disabled=false}:{calendars:CalendarDraft[];onChange:(feeds:CalendarDraft[])=>void;disabled?:boolean}){
 return <fieldset disabled={disabled} className="listing-calendar-setup"><legend>Calendar links (optional)</legend><p>Paste private Airbnb or Vrbo iCal export links, not listing page links. You can also add calendars later in Settings.</p><div className="owner-create-supply-grid">{calendars.map((feed,index)=><CalendarSetupCard key={feed.id} title={`Calendar ${index+1}`} provider={feed.provider} url={feed.url} onProvider={provider=>onChange(calendars.map(c=>c.id===feed.id?{...c,provider}:c))} onUrl={url=>onChange(calendars.map(c=>c.id===feed.id?{...c,url}:c))} remove={()=>onChange(calendars.filter(c=>c.id!==feed.id))}/>)}</div><button type="button" className="bloom-button secondary" onClick={()=>onChange([...calendars,{id:crypto.randomUUID(),provider:'airbnb',url:''}])}>+ Add calendar</button></fieldset>;
}
