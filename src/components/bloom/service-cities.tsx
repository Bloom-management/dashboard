'use client';
import {useCallback,useState} from 'react';
import Link from 'next/link';
import {request} from './api';
import {ErrorNotice,Loading,useResource} from './primitives';
import {Select} from '../ui/select';
import styles from './service-cities.module.css';
type City={id:string;name:string;active:boolean;properties:number;cleaners:number};
export function ServiceCities(){
 const load=useCallback((signal:AbortSignal)=>request<City[]>('/admin/cities',{signal}),[]);
 const data=useResource(load);const [search,setSearch]=useState(''),[status,setStatus]=useState('all');
 const cities=(data.data??[]).filter(city=>city.name.toLowerCase().includes(search.trim().toLowerCase())&&(status==='all'||city.active===(status==='active')));
 return <section className={styles.screen} aria-label="Service areas"><header className={styles.heading}><div><h2>Bloom service areas</h2><p>Review city availability, properties, and approved cleaners.</p></div><Link className="bloom-button secondary" href="/admin?view=requests">Review requests →</Link></header>
 <div className={styles.filters}><label>Search cities<input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search by city name"/></label><label>Status<Select value={status} onChange={event=>setStatus(event.target.value)}><option value="all">All cities</option><option value="active">Active</option><option value="inactive">Inactive</option></Select></label><button className="bloom-button secondary" disabled={data.loading} onClick={data.reload}>Refresh</button></div>
 {data.loading?<Loading/>:data.error?<ErrorNotice error={data.error} retry={data.reload}/>:<><p className={styles.summary}>{data.data?.filter(city=>city.active).length??0} active · {data.data?.filter(city=>!city.active).length??0} inactive</p><div className={styles.grid}>{cities.map(city=><article className={styles.card} key={city.id}><header><h3>{city.name}</h3><span className={city.active?styles.active:styles.inactive}>{city.active?'Active':'Inactive'}</span></header><dl><div><dt>Properties</dt><dd>{city.properties}</dd></div><div><dt>Approved cleaners</dt><dd>{city.cleaners}</dd></div></dl><p>{city.active?'Available in Bloom’s city selection.':'Not offered for new city selections.'}</p></article>)}</div>{!cities.length&&<p>No cities match your filters.</p>}<p className={styles.summary}>Cleaner counts show approved city assignments, not current availability. Private property teams are managed separately.</p></>}
 </section>;
}
