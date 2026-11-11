'use client';
import {useCallback,useState} from 'react';
import type {SupplyLevel} from '../../../contracts';
import {request} from '../api';
import {ErrorNotice,Icon,Loading,useResource} from '../primitives';
import {supplyLevels} from '../journey-draft';
import {SupplyLevelIcon} from '../cleaner-journey';
import {RoomPicker} from './room-picker';
import journey from '../cleaner-journey.module.css';
import styles from './drafts.module.css';
import {categoryLabel} from './category';

export type RoomSupplyItem={id:string;kind:'supply'|'maintenance';category:string;name:string;scope:'room'|'shared';value:string|null;reportedAt:string|null;revision:number};
const levels=Object.keys(supplyLevels) as SupplyLevel[];

export function loadRoomItems(propertyId:string,jobId:string,signal?:AbortSignal){
 return request<RoomSupplyItem[]>(`/house-items?${new URLSearchParams({propertyId,jobId})}`,{signal});
}
/** A report made after the visit started belongs to this visit; earlier ones are the "last reported" reference. */
export function reportedThisVisit(item:RoomSupplyItem,startedAt:string|null){
 return !!item.value&&!!item.reportedAt&&!!startedAt&&Date.parse(item.reportedAt)>=Date.parse(startedAt);
}
export function reportSupply(propertyId:string,jobId:string,item:RoomSupplyItem,value:SupplyLevel){
 return request('/house-items',{body:{propertyId,itemId:item.id,revision:item.revision,action:'report',value,jobId},key:crypto.randomUUID()});
}

/** The whole-home supply questions, adapted for rooms: pick a unit or Shared, then report each item's level. */
export function RoomSupplyCheck({rooms,jobId,startedAt,disabled=false}:{rooms:{propertyId:string;identifier:string}[];jobId:string;startedAt:string|null;disabled?:boolean}){
 const [scopeChoice,setScope]=useState<'room'|'shared'|null>(null);
 const [room,setRoom]=useState(rooms[0]?.propertyId??'');
 const propertyId=room||rooms[0]?.propertyId||'';
 const load=useCallback((signal:AbortSignal)=>loadRoomItems(propertyId,jobId,signal),[propertyId,jobId]);
 // Keep the questions on screen while a report refreshes the list.
 const items=useResource(load,true);
 const [saving,setSaving]=useState<string>(),[error,setError]=useState<unknown>();
 const [chosen,setChosen]=useState<Record<string,SupplyLevel>>({});
 async function choose(item:RoomSupplyItem,level:SupplyLevel){
  if(saving||disabled)return;
  setSaving(item.id);setError(undefined);setChosen(value=>({...value,[item.id]:level}));
  try{await reportSupply(propertyId,jobId,item,level);items.reload();}
  catch(e){setError(e);setChosen(value=>{const next={...value};delete next[item.id];return next;});items.reload();}
  finally{setSaving(undefined);}
 }
 // Open on Shared when this unit has no room-level supplies.
 const scope=scopeChoice??(items.data?.some(item=>item.kind==='supply'&&item.scope==='room')===false?'shared':'room');
 const visible=items.data?.filter(item=>item.kind==='supply'&&item.scope===scope)??[];
 return <div className={styles.houseItems}>
  <div className={styles.choices}>{(['room','shared'] as const).map(s=><button type="button" aria-pressed={scope===s} key={s} onClick={()=>setScope(s)}><Icon name={s==='room'?'grid':'house'} size={28}/><strong>{s==='room'?'Room':'Shared'}</strong></button>)}</div>
  {scope==='room'&&rooms.length>1&&<RoomPicker rooms={rooms} value={propertyId} onChange={setRoom} disabled={!!saving}/>}
  {items.loading&&!items.data?<Loading/>:items.error?<ErrorNotice error={items.error} retry={items.reload}/>:<div>
   {visible.map(item=>{
    const current=reportedThisVisit(item,startedAt);
    const level=chosen[item.id]??(current?item.value as SupplyLevel:'full');
    return <fieldset className={journey.question} key={item.id} disabled={disabled} aria-busy={saving===item.id||undefined}>
     <legend>{item.name} level?</legend>
     <p>{current?`${categoryLabel(item.category)} · Reported for this cleaning`:item.value&&item.reportedAt?`${categoryLabel(item.category)} · Last reported: ${supplyLevels[item.value as SupplyLevel]??item.value} · ${new Date(item.reportedAt).toLocaleString()}`:`${categoryLabel(item.category)} · Defaults to Full · Change the level if needed`}</p>
     <div className={journey.choices}>{levels.map(option=><button type="button" key={option} aria-pressed={level===option} data-picked={chosen[item.id]===option||undefined} onClick={()=>void choose(item,option)}><SupplyLevelIcon level={option}/><span>{supplyLevels[option]}</span></button>)}</div>
     {['low','empty','not_found'].includes(level)&&<p className={journey.attention}>Needs attention · {supplyLevels[level]}</p>}
    </fieldset>;
   })}
   {!visible.length&&<p>No {scope==='shared'?'shared':'room'} supplies are configured.</p>}
  </div>}
  {error!=null&&<ErrorNotice error={error}/>}
 </div>;
}
