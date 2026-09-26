'use client';
import {useCallback,useRef,useState} from 'react';
import type {SessionUser} from '../../contracts';
import type {CleanerNetwork} from '../../contracts/cleaning-teams';
import {request} from './api';
import {ErrorNotice,Loading,useResource} from './primitives';
import {LocationDropdown} from './location-dropdown';

export function CleanerNetworkSettings({user,onSaved}:{user:SessionUser;onSaved:()=>void}) {
 const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[chooseCity,setChooseCity]=useState(false),[city,setCity]=useState('');
 const load=useCallback((signal:AbortSignal)=>chooseCity?request<{id:string;name:string;active:boolean}[]>('/cities',{signal}):Promise.resolve([]),[chooseCity]);const cities=useResource(load);
 const lock=useRef(false),attempt=useRef<{signature:string;key:string}|null>(null);
 async function save(enabled:boolean){if(lock.current)return;if(enabled&&!user.approvedCityId&&!city){setChooseCity(true);return;}lock.current=true;setBusy(true);setError(undefined);const body={enabled,...(enabled&&!user.approvedCityId?{cityId:city}:{})};const signature=JSON.stringify(body);if(attempt.current?.signature!==signature)attempt.current={signature,key:crypto.randomUUID()};try{await request<CleanerNetwork>('/cleaner/network',{body,key:attempt.current.key});attempt.current=null;setChooseCity(false);onSaved();}catch(failure){setError(failure);}finally{lock.current=false;setBusy(false);}}
 return <section className="bloom-notice" aria-label="Bloom network preference"><label><input type="checkbox" checked={user.bloomNetworkEnabled!==false} disabled={busy} onChange={event=>save(event.target.checked)}/> Receive opportunities from Bloom</label><p>You can clean your private properties either way. Turning this off keeps your accepted cleanings and earned balances.</p>{!user.approvedCityId&&<p>Choose a supported city when joining Bloom’s network. Your private work does not need a service city.</p>}{chooseCity&&<>{cities.loading?<Loading/>:cities.error?<ErrorNotice error={cities.error} retry={cities.reload}/>:<LocationDropdown label="Which city will you clean in?" locations={(cities.data??[]).filter(item=>item.active)} value={city} onValueChange={setCity} disabled={busy}/>}<p>Your first supported city needs no approval. Later city changes require admin approval.</p><button className="bloom-button" disabled={busy||!city||cities.loading||!!cities.error} onClick={()=>save(true)}>Join Bloom’s cleaner network</button><button className="bloom-button secondary" disabled={busy} onClick={()=>setChooseCity(false)}>Keep private work only</button></>}{busy&&<p role="status">Saving preference…</p>}{!!error&&<ErrorNotice error={error}/>}</section>;
}
