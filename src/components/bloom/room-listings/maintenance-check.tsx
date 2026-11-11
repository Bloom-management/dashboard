'use client';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import type {CleanerJob,SessionUser} from '../../../contracts';
import type {BloomIntegration} from '../integration';
import {Photos} from '../photos';
import journey from '../cleaner-journey.module.css';
import {request} from '../api';
import {ErrorNotice,Icon,Loading,useResource} from '../primitives';
import {RoomPicker} from './room-picker';
import {loadRoomItems,reportedThisVisit,type RoomSupplyItem} from './supply-check';
import styles from './drafts.module.css';

type Status='good'|'issue'|'not_applicable';
const choices=[{status:'good' as const,label:'No issue'},{status:'issue' as const,label:'Needs attention'}];

// Room items are free-form, so pick the whole-home style icon by keyword.
const icons:[RegExp,string][]=[
 [/refrigerator|freezer|fridge/i,'M6 2h12v20H6zM6 10h12M9 5v2M9 13v3'],
 [/wall|paint/i,'M4 3h13v6H4zM17 5h3v7h-8v8M10 20h4'],
 [/wi-?fi|internet/i,'M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0M12 20h.01'],
 [/\btv\b|television/i,'M3 6h18v13H3zM8 2l4 4 4-4M8 22h8'],
 [/heating|air condition|climate|thermostat/i,'M3 4h18v9H3zM6 9h12M7 16v5M12 16v3M17 16v5'],
 [/smoke|fire|extinguisher|alarm/i,'M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 2 3 3 3 0-3-1-5 0-8Z'],
 [/door|lock|keypad|entry/i,'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4M12 15v2'],
 [/bed|mattress/i,'M3 18V8M3 14h18v4M21 18v-4a3 3 0 0 0-3-3h-8v3M6 11h2'],
 [/window|shade/i,'M4 3h16v18H4zM12 3v18M4 12h16'],
 [/faucet|sink|bath|toilet|drain|hot water|shower|dishwasher|washer/i,'M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13ZM8 15a4 4 0 0 0 4 4'],
 [/light|electric|outlet|dryer|microwave|kettle|toaster|coffee|stove|oven|iron|compactor/i,'m13 2-8 12h6l-1 8 9-13h-7l1-7Z'],
];
const wrench='M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6Z';
function ItemIcon({name}:{name:string}){
 const path=icons.find(([pattern])=>pattern.test(name))?.[1]??wrench;
 return <svg width="28" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path}/></svg>;
}

export function reportMaintenance(propertyId:string,jobId:string,item:RoomSupplyItem,value:Status){
 return request('/house-items',{body:{propertyId,itemId:item.id,revision:item.revision,action:'report',value,jobId},key:crypto.randomUUID()});
}

// Comment saves still in flight, so Continue can wait for them before validating.
export const pendingIssueNotes=new Set<Promise<unknown>>();
export function loadIssueNotes(jobId:string,signal?:AbortSignal){return request<Record<string,string>>(`/jobs/${jobId}/item-notes`,{signal});}

/** Expands under "Needs attention", like the whole-home issue note, with chat-style photo previews. */
function IssueNote({item,job,user,integration,initial,disabled}:{item:RoomSupplyItem;job:CleanerJob;user:SessionUser;integration:BloomIntegration;initial:string;disabled:boolean}){
 const id=useId();
 const [text,setText]=useState(initial),[error,setError]=useState<unknown>();
 const [picker,setPicker]=useState<HTMLDivElement|null>(null),[preview,setPreview]=useState<HTMLDivElement|null>(null);
 const saved=useRef(initial);
 const save=useCallback((value:string)=>{
  if(value===saved.current)return;
  saved.current=value;setError(undefined);
  const pending=request(`/jobs/${job.id}/item-notes`,{body:{itemId:item.id,notes:value},key:crypto.randomUUID()}).catch(e=>{saved.current='';setError(e);});
  pendingIssueNotes.add(pending);void pending.finally(()=>pendingIssueNotes.delete(pending));
 },[item.id,job.id]);
 useEffect(()=>{const timer=setTimeout(()=>save(text),700);return()=>clearTimeout(timer);},[text,save]);
 return <div className={journey.notes}>
  <label htmlFor={id}>What needs attention?</label>
  <div className={journey.noteBox}><div ref={setPreview} className={journey.noteAttachments}/><textarea id={id} maxLength={500} value={text} disabled={disabled} onChange={event=>setText(event.target.value)} onBlur={()=>save(text)}/><div ref={setPicker} className={journey.noteCamera}/></div>
  <Photos job={job} user={user} integration={integration} locked={disabled} noteContext="maintenance" itemId={item.id} pickerTarget={picker} previewTarget={preview}/>
  {error!=null&&<ErrorNotice error={error}/>}
 </div>;
}

/** The whole-home maintenance cards, adapted for rooms: pick a unit or Shared, then mark each item. */
export function RoomMaintenanceCheck({rooms,job,user,integration,startedAt,disabled=false}:{rooms:{propertyId:string;identifier:string}[];job:CleanerJob;user:SessionUser;integration:BloomIntegration;startedAt:string|null;disabled?:boolean}){
 const jobId=job.id;
 const loadNotes=useCallback((signal:AbortSignal)=>loadIssueNotes(jobId,signal),[jobId]);
 const notes=useResource(loadNotes,true);
 const [scopeChoice,setScope]=useState<'room'|'shared'|null>(null);
 const [room,setRoom]=useState(rooms[0]?.propertyId??'');
 const propertyId=room||rooms[0]?.propertyId||'';
 const load=useCallback((signal:AbortSignal)=>loadRoomItems(propertyId,jobId,signal),[propertyId,jobId]);
 const items=useResource(load,true);
 const [saving,setSaving]=useState<string>(),[error,setError]=useState<unknown>();
 const [chosen,setChosen]=useState<Record<string,Status>>({});
 const scope=scopeChoice??(items.data?.some(item=>item.kind==='maintenance'&&item.scope==='room')===false?'shared':'room');
 const visible=items.data?.filter(item=>item.kind==='maintenance'&&item.scope===scope)??[];
 async function choose(item:RoomSupplyItem,status:Status){
  if(saving||disabled)return;
  setSaving(item.id);setError(undefined);setChosen(value=>({...value,[item.id]:status}));
  try{await reportMaintenance(propertyId,jobId,item,status);items.reload();}
  catch(e){setError(e);setChosen(value=>{const next={...value};delete next[item.id];return next;});items.reload();}
  finally{setSaving(undefined);}
 }
 return <div className={styles.houseItems}>
  <div className={styles.choices}>{(['room','shared'] as const).map(s=><button type="button" aria-pressed={scope===s} key={s} onClick={()=>setScope(s)}><Icon name={s==='room'?'grid':'house'} size={28}/><strong>{s==='room'?'Room':'Shared'}</strong></button>)}</div>
  {scope==='room'&&rooms.length>1&&<RoomPicker rooms={rooms} value={propertyId} onChange={setRoom} disabled={!!saving}/>}
  {items.loading&&!items.data?<Loading/>:items.error?<ErrorNotice error={items.error} retry={items.reload}/>:<div className="maintenance-mobile-stack">
   {visible.map(item=>{
    // Defaults to No issue; reports from this visit (or taps) override it.
    const status=chosen[item.id]??(reportedThisVisit(item,startedAt)&&item.value!=='not_applicable'?item.value as Status:'good');
    return <fieldset key={item.id} className="maintenance-card maintenance-report-card" disabled={disabled} aria-busy={saving===item.id||undefined}>
     <legend>{item.name}</legend>
     <div className="maintenance-options">{choices.map(choice=><button type="button" key={choice.status} className="maintenance-choice" aria-label={`${item.name}: ${choice.label}`} aria-pressed={status===choice.status} onClick={()=>void choose(item,choice.status==='issue'&&status==='issue'?'good':choice.status)}><ItemIcon name={item.name}/><span>{choice.label}</span></button>)}</div>
     {status==='issue'&&notes.data&&<IssueNote item={item} job={job} user={user} integration={integration} initial={notes.data[item.id]??''} disabled={disabled}/>}
    </fieldset>;
   })}
   {!visible.length&&<p>No {scope==='shared'?'shared':'room'} maintenance items are configured.</p>}
  </div>}
  {error!=null&&<ErrorNotice error={error}/>}
 </div>;
}
