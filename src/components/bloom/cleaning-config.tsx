'use client';
import type { ReactNode } from 'react';
import { Icon } from './primitives';
import { useCallback, useRef, useState } from 'react';
import type { CleaningConfig, PhotoCategory, JobJourney } from '../../contracts';
import { ApiError, request } from './api';
import { ErrorNotice, Loading, useResource } from './primitives';
import { MaintenanceGrid } from './maintenance';
import { SupplySetupGrid } from './supply-setup-grid';
import { supplyLevels } from './journey-draft';

const roomNames:Record<PhotoCategory,string>={bedrooms:'Bedroom',bathrooms:'Bathroom',kitchen:'Kitchen',living_room:'Living room'};
function defaultLabel(type:PhotoCategory,rooms:CleaningConfig['rooms']){
  let number=1;
  while(rooms.some(room=>room.label===`${roomNames[type]} ${number}`))number++;
  return `${roomNames[type]} ${number}`;
}
function newRoom(type:PhotoCategory,rooms:CleaningConfig['rooms']=[]):CleaningConfig['rooms'][number]{return {id:crypto.randomUUID(),type,label:defaultLabel(type,rooms),requiredPhoto:true};}
function labelRooms(rooms:CleaningConfig['rooms']){
  const result=rooms.map(room=>({...room}));
  for(const room of result)if(!room.label.trim())room.label=defaultLabel(room.type,result);
  return result;
}
export function CleaningConfiguration({propertyId,owner=false,bedroomCount=0,bathroomCount=0,onSaved,calendar,people}:{propertyId:string;owner?:boolean;bedroomCount?:number|null;bathroomCount?:number|null;onSaved?:()=>void;calendar?:ReactNode;people?:ReactNode}) {
  const path=`/${owner?'owner':'admin'}/properties/${propertyId}/cleaning-config`;
  const load=useCallback((signal:AbortSignal)=>request<CleaningConfig|null>(path,{signal}),[path]);
  const data=useResource(load);const [message,setMessage]=useState('');
  const [section,setSection]=useState(0);const sections=['Rooms','Supplies',...(calendar?['Calendar']:[]),...(people?['People']:[])];
  return <section className="bloom-admin-card"><h2>Property setup</h2><div className="owner-detail-navigation"><div className="view-toggle" role="group" aria-label="Setup sections">{sections.map((name,index)=><button type="button" key={name} className={`vt-btn${section===index?' active':''}`} aria-pressed={section===index} onClick={()=>setSection(index)}>{name}</button>)}</div><div className="owner-carousel-controls"><button type="button" className="icon-btn" aria-label="Previous setup section" onClick={()=>setSection((section+sections.length-1)%sections.length)}><Icon name="left"/></button><button type="button" className="icon-btn" aria-label="Next setup section" onClick={()=>setSection((section+1)%sections.length)}><Icon name="right"/></button></div></div><div hidden={section>=2}>{data.loading?<Loading/>:data.error?<ErrorNotice error={data.error} retry={data.reload}/>:<ConfigForm section={section} key={data.data?.version ?? 0} path={path} owner={owner} bedroomCount={bedroomCount??0} bathroomCount={bathroomCount??0} initial={data.data??{version:0,rooms:[],supplies:[]}} saved={()=>{data.reload();onSaved?.();}} onSuccess={()=>setMessage('Room and supply configuration saved.')}/>}<p role="status">{message}</p></div><div hidden={sections[section]!=='Calendar'}>{calendar}</div><div hidden={sections[section]!=='People'}>{people}</div></section>;
}
function ConfigForm({section,path,owner,bedroomCount,bathroomCount,initial,saved,onSuccess}:{section:number;path:string;owner:boolean;bedroomCount:number;bathroomCount:number;initial:CleaningConfig;saved:()=>void;onSuccess:()=>void}) {
  const [config,setConfig]=useState<CleaningConfig>(()=>{
    const rooms=initial.version||!owner?initial.rooms:[...Array.from({length:bedroomCount},()=>({...newRoom('bedrooms'),label:''})),...Array.from({length:bathroomCount},()=>({...newRoom('bathrooms'),label:''})),newRoom('kitchen'),newRoom('living_room')];
    return {...initial,rooms:labelRooms(rooms)};
  });const [busy,setBusy]=useState(false);const [error,setError]=useState<unknown>();const [uncertain,setUncertain]=useState(false);const lock=useRef(false);
  const [activeRoom,setActiveRoom]=useState(0);
  const roomIndex=Math.min(activeRoom,Math.max(0,config.rooms.length-1));
  const room=config.rooms[roomIndex];
  function addRoom(type:PhotoCategory){setActiveRoom(config.rooms.length);setConfig(current=>({...current,rooms:[...current.rooms,newRoom(type,current.rooms)]}));}
  const attempt=useRef<{serialized:string;key:string}|undefined>(undefined);
  function quantity(type:PhotoCategory,delta:number){setConfig(current=>{const matching=current.rooms.filter(room=>room.type===type);if(delta>0&&matching.length<20)return {...current,rooms:[...current.rooms,newRoom(type,current.rooms)]};if(delta<0&&matching.length)return {...current,rooms:current.rooms.filter(room=>room.id!==matching.at(-1)!.id)};return current;});}
  return <form className="bloom-form" onSubmit={async event=>{event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);const serialized=JSON.stringify(config);if(!uncertain&&attempt.current?.serialized!==serialized)attempt.current={serialized,key:crypto.randomUUID()};try{await request(path,{body:JSON.parse(attempt.current!.serialized),key:attempt.current!.key});attempt.current=undefined;setUncertain(false);onSuccess();saved();}catch(failure){setError(failure);const unknown=!(failure instanceof ApiError)||['NETWORK_ERROR','SOURCE_UNAVAILABLE','CONFIGURATION_ERROR'].includes(failure.code);setUncertain(unknown);if(!unknown)attempt.current=undefined;}finally{lock.current=false;setBusy(false);}}}>
    <div hidden={section!==0}><p>List every actual bedroom and bathroom, plus the kitchen and living room. Each room needs its own ready photo.</p>
    {owner&&<fieldset disabled={busy||uncertain}><legend>Room counts</legend><div className="owner-room-counts">{(['bedrooms','bathrooms'] as const).map(type=><div className="owner-room-count-card" key={type}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{type==='bathrooms'?<path d="M3 12h18v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-3ZM5 12V5a2 2 0 0 1 4 0M6 19v2M18 19v2"/>:<path d="M3 18V6M21 18V6M3 15h18M3 10h18v5M6 10V7h5v3M13 10V7h5v3"/>}</svg><h4>{type==='bedrooms'?'Bedrooms':'Bathrooms'}</h4><div className="owner-room-stepper"><button type="button" aria-label={`Decrease ${type}`} disabled={!config.rooms.some(r=>r.type===type)} onClick={()=>quantity(type,-1)}>−</button><output aria-label={`${type==='bedrooms'?'Bedrooms':'Bathrooms'} count`}>{config.rooms.filter(r=>r.type===type).length}</output><button type="button" aria-label={`Increase ${type}`} disabled={config.rooms.filter(r=>r.type===type).length>=20} onClick={()=>quantity(type,1)}>+</button></div></div>)}</div><p>Name each actual room below, then save to apply your changes. Removing a room affects future cleaning checklists.</p></fieldset>}
    <fieldset disabled={busy||uncertain} className="cleaning-room-carousel"><legend>Actual rooms</legend>
      <div className="cleaning-room-toolbar">
        <span role="status">{config.rooms.length ? `Room ${roomIndex+1} of ${config.rooms.length}` : 'No rooms added'}</span>
        <div className="cleaning-room-arrows">
          <button type="button" className="bloom-button secondary" aria-label="Previous room" disabled={roomIndex===0} onClick={()=>setActiveRoom(roomIndex-1)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></button>
          <button type="button" className="bloom-button secondary" aria-label="Next room" disabled={roomIndex>=config.rooms.length-1} onClick={()=>setActiveRoom(roomIndex+1)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>
        </div>
      </div>
      {room&&<div className="bloom-admin-card cleaning-room-slide" role="group" aria-roledescription="slide" aria-label={`Room ${roomIndex+1} of ${config.rooms.length}`} key={room.id}>
        <label>Room label<input required maxLength={100} value={room.label} onChange={event=>setConfig({...config,rooms:config.rooms.map(r=>r.id===room.id?{...r,label:event.target.value}:r)})}/></label>
        <label>Room type<select aria-label="Room type" value={room.type} onChange={event=>{
          const type=event.target.value as PhotoCategory;
          const generated=new RegExp(`^${roomNames[room.type]} [0-9]+$`).test(room.label);
          setConfig({...config,rooms:config.rooms.map(r=>r.id===room.id?{...r,type,label:generated||!r.label.trim()?defaultLabel(type,config.rooms.filter(other=>other.id!==r.id)):r.label}:r)});
        }}>{Object.entries(roomNames).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
        <button type="button" className="bloom-button secondary" onClick={()=>{setActiveRoom(Math.max(0,roomIndex-1));setConfig({...config,rooms:config.rooms.filter(r=>r.id!==room.id)});}}>Remove room</button>
      </div>}
      <button type="button" className="bloom-button secondary" disabled={config.rooms.length>=100} onClick={()=>addRoom('bedrooms')}>Add actual room</button>
    </fieldset>
    </div><div hidden={section!==1}><SupplySetupGrid supplies={config.supplies} onChange={supplies=>setConfig({...config,supplies})} disabled={busy||uncertain}/></div>
    <p>Changes apply to future and unconfigured cleanings. Existing cleaning checklists and uploaded photos stay unchanged. Saving with no supplies explicitly confirms an empty supply checklist.</p><button className="bloom-button" disabled={busy||config.supplies.some(s=>!s.name.trim())||config.rooms.some(r=>!r.label.trim())||!config.rooms.some(r=>r.type==='kitchen')||!config.rooms.some(r=>r.type==='living_room')}>{busy?'Saving…':uncertain?'Retry saving configuration':'Save room and supply configuration'}</button>{uncertain&&<p role="status">The save result is uncertain. Retry the same configuration safely before making other changes.</p>}{!!error&&<ErrorNotice error={error}/>} {error instanceof ApiError&&error.code==='CONFLICT'&&<button type="button" className="bloom-button secondary" onClick={saved}>Discard draft and reload saved configuration</button>}</form>;
}
export function CompletionReport({jobId}:{jobId:string}) {
  const load=useCallback((signal:AbortSignal)=>request<JobJourney>(`/jobs/${jobId}/journey`,{signal}),[jobId]);const data=useResource(load);
  return data.loading?<Loading/>:data.error?<ErrorNotice error={data.error} retry={data.reload}/>:data.data?.receipt?<section className="info-row"><h3>Completion supply report</h3>{data.data.receipt.reports.map(report=><p className={['low','empty','not_found'].includes(report.level)?'bloom-notice':undefined} key={report.supplyId}>{report.name}: {supplyLevels[report.level]}</p>)}<p className="bloom-prewrap">{data.data.receipt.notes}</p>{data.data.receipt.maintenance&&<MaintenanceGrid reports={data.data.receipt.maintenance}/>}<p>Completed · No approval required.</p></section>:null;
}
