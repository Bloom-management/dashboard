'use client';
import {useRef,useState} from 'react';
import type {SessionUser} from '../../contracts';
import type {CleanerNetwork} from '../../contracts/cleaning-teams';
import {request} from './api';
import {ErrorNotice} from './primitives';

export function CleanerNetworkSettings({user,onSaved}:{user:SessionUser;onSaved:()=>void}) {
 const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
 const lock=useRef(false);
 async function save(enabled:boolean){if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);try{await request<CleanerNetwork>('/cleaner/network',{body:{enabled}});onSaved();}catch(failure){setError(failure);}finally{lock.current=false;setBusy(false);}}
 return <section className="bloom-notice" aria-label="Bloom network preference"><label><input type="checkbox" checked={user.bloomNetworkEnabled!==false} disabled={busy} onChange={event=>save(event.target.checked)}/> Receive opportunities from Bloom</label><p>You can clean your private properties either way. Turning this off keeps your accepted cleanings and earned balances.</p>{!user.approvedCityId&&<p>Choose a supported city above before joining Bloom’s network. Your private work does not need a service city.</p>}{busy&&<p role="status">Saving preference…</p>}{!!error&&<ErrorNotice error={error}/>}</section>;
}
