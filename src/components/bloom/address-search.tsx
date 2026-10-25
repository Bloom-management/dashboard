'use client';
import {useEffect,useRef,useState} from 'react';
import {request} from './api';
import {ErrorNotice} from './primitives';
import styles from './city-registration.module.css';
type Match={label:string;city:string;timezone:string;token:string};
export type SelectedAddress={address:string;cityId:string;city:string;timezone:string;latitude:number;longitude:number};
export function AddressSearch({value,disabled,onChange,onSelect}:{value:string;disabled:boolean;onChange:(value:string)=>void;onSelect:(value:SelectedAddress|null)=>void}){
 const [matches,setMatches]=useState<Match[]>([]),[selected,setSelected]=useState<SelectedAddress|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();const selecting=useRef(false);
 useEffect(()=>{
  if(disabled||selected||value.trim().length<4)return;
  const controller=new AbortController();const timer=setTimeout(()=>{setBusy(true);void request<Match[]>('/locations/addresses?q='+encodeURIComponent(value),{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setMatches(data);}).catch(e=>{if(!controller.signal.aborted)setError(e);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});},700);
  return()=>{clearTimeout(timer);controller.abort();};
 },[value,disabled,selected]);
 async function select(match:Match){if(selecting.current)return;selecting.current=true;setBusy(true);setError(undefined);try{const address=await request<SelectedAddress>('/locations/addresses',{body:{place:match.token}});setSelected(address);setMatches([]);onChange(address.address);onSelect(address);}catch(e){setError(e);}finally{selecting.current=false;setBusy(false);}}
 return <div><label>Street address<input value={value} maxLength={200} autoComplete="off" placeholder="Start typing the property address" disabled={disabled||selecting.current} onChange={e=>{onChange(e.target.value);onSelect(null);setSelected(null);setMatches([]);setError(undefined);}} required/></label>
 {busy&&<p role="status">Finding address…</p>}
 {!selected&&matches.length>0&&<ul className={styles.results} aria-label="Address suggestions">{matches.map(match=><li key={match.token}><button type="button" disabled={disabled||busy} onClick={()=>void select(match)}>{match.label}</button></li>)}</ul>}
 {selected&&<div className={styles.cityDetails}><strong>{selected.city}</strong><span className={styles.timezone}>Local timezone: {selected.timezone.replaceAll('_',' ')}</span></div>}
 {!!error&&<ErrorNotice error={error}/>}</div>;
}
