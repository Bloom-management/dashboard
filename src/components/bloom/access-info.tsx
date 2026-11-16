'use client';
import {useCallback,useState} from 'react';
import {request} from './api';
import {ErrorNotice,Loading,Modal,useResource, Icon} from './primitives';
import {Select} from '../ui/select';
import styles from './access-info.module.css';
import {BackButton} from './back-button';
const entryTypes={keypad:'Keypad',key:'Key',lockbox:'Lockbox',other:'Other'};
const parkingTypes={free_street:'Free street parking',paid_street:'Paid street parking',driveway:'Driveway',garage:'Garage'};
export type AccessDetails={entryType:keyof typeof entryTypes;code:string;entryNotes:string;parking:(keyof typeof parkingTypes)[];garageCode:string;parkingNotes:string;version:number};
/** Details for a property with no saved access info yet (version 0 creates it). */
export const emptyAccess:AccessDetails={entryType:'other',code:'',entryNotes:'',parking:[],garageCode:'',parkingNotes:'',version:0};
/** Entry type and parking suggested by an Airbnb listing's amenities. */
export function accessFromAmenities(amenities:string[],current:AccessDetails):AccessDetails{
 const has=(pattern:RegExp)=>amenities.some(a=>pattern.test(a));
 const entryType=current.entryType!=='other'?current.entryType:has(/keypad|smart lock/i)?'keypad':has(/lockbox/i)?'lockbox':current.entryType;
 const found:(keyof typeof parkingTypes)[]=[];
 if(has(/garage/i))found.push('garage');
 if(has(/driveway|parking on premises/i))found.push('driveway');
 if(has(/free street parking/i))found.push('free_street');
 if(has(/paid street parking/i))found.push('paid_street');
 return {...current,entryType,parking:current.parking.length?current.parking:found};
}
/** Entry fields shared by the Edit entry dialog and Add listing. */
export function AccessEntryFields({value,onChange}:{value:AccessDetails;onChange:(value:AccessDetails)=>void}){
 return <div className={styles.fields}><label>Entry type<Select value={value.entryType} onChange={event=>onChange({...value,entryType:event.target.value as AccessDetails['entryType']})}>{Object.entries(entryTypes).map(([key,label])=><option key={key} value={key}>{label}</option>)}</Select></label><label>Entry code (optional)<input maxLength={2000} value={value.code} onChange={event=>onChange({...value,code:event.target.value})}/></label><label>Entry details<textarea maxLength={2000} value={value.entryNotes} onChange={event=>onChange({...value,entryNotes:event.target.value})}/></label></div>;
}
/** Parking fields shared by the Edit parking dialog and Add listing. */
export function AccessParkingFields({value,onChange}:{value:AccessDetails;onChange:(value:AccessDetails)=>void}){
 return <div className={styles.fields}>{Object.entries(parkingTypes).map(([key,label])=><label className={styles.check} key={key}><input type="checkbox" checked={value.parking.includes(key as keyof typeof parkingTypes)} onChange={event=>onChange({...value,parking:event.target.checked?[...value.parking,key as keyof typeof parkingTypes]:value.parking.filter(item=>item!==key)})}/>{label}</label>)}{value.parking.includes('garage')&&<label>Garage entry code (optional)<input maxLength={2000} value={value.garageCode} onChange={event=>onChange({...value,garageCode:event.target.value})}/></label>}<label>Parking details<textarea maxLength={2000} value={value.parkingNotes} onChange={event=>onChange({...value,parkingNotes:event.target.value})}/></label></div>;
}
type Access={info:AccessDetails;instructions:string;canEdit:boolean};
const entryIcon=<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#020202" strokeWidth="1.91" strokeMiterlimit="10" aria-hidden="true"><path d="M15.82,11.05v9.54a1.91,1.91,0,0,1-1.91,1.91H4.36a1.91,1.91,0,0,1-1.91-1.91V3.41A1.91,1.91,0,0,1,4.36,1.5h9.55a1.91,1.91,0,0,1,1.91,1.91V7.23"/><path d="M19.64,7.23H11.26a2.86,2.86,0,1,0,0,3.82h8.38a1.91,1.91,0,0,0,0-3.82Z"/><path d="M5.32 16.77h7.63"/></svg>;
const parkingIcon=<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={'M3 11 12 3l9 8v10H3zM6 21v-9h12v9M6 15h12M6 18h12'}/></svg>;

/** Entry and parking cards without details, for unclaimed cleanings or properties without access info yet. */
export function AccessInfoPlaceholder({note}:{note:string}){
 return <div className={styles.grid}>{(['entry','parking'] as const).map(kind=><article className={`${styles.card} ${styles.placeholder}`} key={kind}><header>{kind==='entry'?entryIcon:parkingIcon}</header><h3>{kind==='entry'?'Entry':'Parking'}</h3><p className={styles.summary}><span>{note}</span></p></article>)}</div>;
}
export function AccessInfo({propertyId}:{propertyId:string}){
 const load=useCallback((signal:AbortSignal)=>request<Access|null>(`/properties/${propertyId}/access-info`,{signal}),[propertyId]);
 const resource=useResource(load);const [editing,setEditing]=useState<'entry'|'parking'|null>(null),[draft,setDraft]=useState<AccessDetails|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[expanded,setExpanded]=useState<'entry'|'parking'|null>(null);
 if(resource.loading)return <Loading/>;
 if(resource.error)return <ErrorNotice error={resource.error} retry={resource.reload}/>;
 if(!resource.data)return <AccessInfoPlaceholder note="Not added yet"/>;
 const {info,instructions,canEdit}=resource.data;
 const body=(kind:'entry'|'parking')=>kind==='entry'?<>{info.code&&<p><strong>Entry code:</strong> {info.code}</p>}<p className="bloom-prewrap">{info.entryNotes||(!info.code?'No entry details provided.':'')}</p>{instructions&&<p className="bloom-prewrap">{instructions}</p>}</>:<>{info.parking.map(type=><p key={type}>{parkingTypes[type]}</p>)}{!info.parking.length&&<p>No parking information provided.</p>}{info.parking.includes('garage')&&info.garageCode&&<p><strong>Garage entry code:</strong> {info.garageCode}</p>}<p className="bloom-prewrap">{info.parkingNotes}</p></>;
 return <><div className={styles.grid}>{(['entry','parking'] as const).map(kind=><article className={styles.card} key={kind}><header>{kind==='entry'?entryIcon:parkingIcon}{canEdit&&<button type="button" aria-label={`Edit ${kind==='entry'?'entry':'parking'} information`} onClick={()=>{setDraft(info);setError(undefined);setEditing(kind);}}>✎</button>}</header><h3>{kind==='entry'?entryTypes[info.entryType]:'Parking'}</h3><button className={styles.summary} type="button" onClick={()=>setExpanded(kind)}><span>{kind==='entry'?(info.code?`Entry code: ${info.code}`:info.entryNotes||instructions||'View entry information'):(info.parking.map(type=>parkingTypes[type]).join(' · ')||'View parking information')}</span><Icon name="right"/></button></article>)}</div>
 {expanded&&<Modal title={expanded==='entry'?'Access info':'Parking'} className={`detail-card ${styles.dialog}`} onClose={()=>setExpanded(null)}><BackButton className={styles.back} onClick={()=>setExpanded(null)}>Back to access info</BackButton><h2>{expanded==='entry'?entryTypes[info.entryType]:'Parking'}</h2>{body(expanded)}</Modal>}
 {editing&&draft&&<Modal title={`Edit ${editing} information`} className={`detail-card ${styles.dialog}`} onClose={()=>{if(!busy)setEditing(null);}}><h2>{editing==='entry'?'Entry information':'Parking information'}</h2><form onSubmit={async event=>{event.preventDefault();if(busy)return;setBusy(true);setError(undefined);try{await request(`/properties/${propertyId}/access-info`,{body:draft});setEditing(null);resource.reload();}catch(e){setError(e);}finally{setBusy(false);}}}><fieldset disabled={busy}>{editing==='entry'?<AccessEntryFields value={draft} onChange={setDraft}/>:<><legend>Available parking</legend><AccessParkingFields value={draft} onChange={setDraft}/></>}</fieldset>{!!error&&<ErrorNotice error={error}/>}<button className="bloom-button" disabled={busy}>{busy?'Saving…':'Save access info'}</button></form></Modal>}
 </>;
}
