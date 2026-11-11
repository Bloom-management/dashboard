'use client';
import {useEffect,useState} from 'react';
import {request} from './api';
import {ErrorNotice, Icon} from './primitives';
import styles from './city-registration.module.css';
export type CityMatch={label:string;token:string;timezone:string};
export function CitySearch({id,value,onChange,onSelect,disabled=false}:{id?:string;value:string;onChange:(value:string)=>void;onSelect:(city:CityMatch|null)=>void;disabled?:boolean}){
 const [results,setResults]=useState<CityMatch[]>([]),[selected,setSelected]=useState<CityMatch|null>(null),[searched,setSearched]=useState(false),[searching,setSearching]=useState(false),[error,setError]=useState<unknown>();
 useEffect(()=>{
  if(selected||value.trim().length<3||disabled)return;
  const controller=new AbortController();
  const timer=setTimeout(()=>{setSearching(true);setError(undefined);void request<CityMatch[]>(`/locations/cities?q=${encodeURIComponent(value.trim())}`,{signal:controller.signal}).then(matches=>{if(!controller.signal.aborted){setResults(matches);setSearched(true);}}).catch(e=>{if(!controller.signal.aborted)setError(e);}).finally(()=>{if(!controller.signal.aborted)setSearching(false);});},600);
  return()=>{clearTimeout(timer);controller.abort();};
 },[value,selected,disabled]);
 function change(value:string){onChange(value);setSelected(null);onSelect(null);setResults([]);setSearched(false);setSearching(false);setError(undefined);}
 return <><div className={styles.search}><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></svg><input id={id} aria-label="City name" autoComplete="off" maxLength={150} value={value} disabled={disabled} onChange={e=>change(e.target.value)} placeholder="Search US cities"/>{value&&<button type="button" aria-label="Clear city search" disabled={disabled} onClick={()=>change('')}><Icon name="close" size={16}/></button>}</div>
 {searching&&<p role="status">Searching cities…</p>}
 {!selected&&results.length>0&&<ul className={styles.results} aria-label="City suggestions">{results.map(result=><li key={result.token}><button type="button" disabled={disabled} onClick={()=>{setSelected(result);onChange(result.label);onSelect(result);}}><span><strong>{result.label.split(', ')[0]}</strong><small>{result.label.split(', ').slice(1).join(', ')}</small></span><Icon name="right"/></button></li>)}</ul>}
 {searched&&!searching&&!selected&&!results.length&&<p role="status">No cities found. Try adding the state.</p>}
 {selected&&<div className={styles.cityDetails}><strong>{selected.label}</strong><span className={styles.timezone}>Local timezone: {selected.timezone.replaceAll('_',' ')}</span></div>}
 {!!error&&<ErrorNotice error={error}/>}</>;
}
