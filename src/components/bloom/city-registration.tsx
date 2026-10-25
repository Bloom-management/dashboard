'use client';
import {useRef,useState} from 'react';
import {request} from './api';
import {Modal,ErrorNotice} from './primitives';
import {CitySearch,type CityMatch} from './city-search';
import styles from './city-registration.module.css';
export type RegisteredCity={id:string;name:string;active:boolean;timezone:string;coverage:string};
export function CityRegistration({onClose,onSaved}:{onClose:()=>void;onSaved:(city:RegisteredCity)=>void}){
 const [query,setQuery]=useState(''),[selected,setSelected]=useState<CityMatch|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();const lock=useRef(false);
 async function save(){if(lock.current||!selected)return;lock.current=true;setBusy(true);setError(undefined);try{const city=await request<RegisteredCity>('/locations/cities',{body:{place:selected.token}});onSaved(city);}catch(e){setError(e);}finally{lock.current=false;setBusy(false);}}
 return <Modal title="Find a city" onClose={()=>{if(!busy)onClose();}}><CitySearch value={query} onChange={setQuery} onSelect={setSelected} disabled={busy}/>
 {selected&&<div className={styles.selection}><button className="bloom-button" disabled={busy} onClick={()=>void save()}>{busy?'Saving…':'Use this city'}</button></div>}
 <p className={styles.hint}>Choose a city to continue. Bloom cleaning coverage is managed separately.</p>{!!error&&<ErrorNotice error={error}/>}</Modal>;
}
