'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {SessionUser} from '../../contracts';
import {request} from './api';
import {ErrorNotice,Loading,useResource} from './primitives';
import {toast} from '../ui/toast';

function NetworkCity({onJoin}:{onJoin:(city:string)=>Promise<void>}){
 const load=useCallback((signal:AbortSignal)=>request<{id:string;name:string;active:boolean}[]>('/cities',{signal}),[]);
 const cities=useResource(load);const [city,setCity]=useState(''),[busy,setBusy]=useState(false);
 return <div className="bloom-toast-city">{cities.loading?<Loading/>:cities.error?<ErrorNotice error={cities.error} retry={cities.reload}/>:<fieldset className="bloom-toast-cities" disabled={busy}><legend>Which city will you clean in?</legend>{(cities.data??[]).filter(item=>item.active).map(item=><label key={item.id}><input type="radio" name="bloom-toast-city" value={item.id} checked={city===item.id} onChange={()=>setCity(item.id)}/>{item.name}</label>)}{!cities.data?.some(item=>item.active)&&<p>No supported cities available right now.</p>}</fieldset>}<button type="button" className="bloom-toast-submit" disabled={!city||busy} onClick={async()=>{setBusy(true);try{await onJoin(city);}finally{setBusy(false);}}}>Request to join Bloom</button></div>;
}
export function CleanerNetworkSettings({user,onSaved}:{user:SessionUser;onSaved:()=>void}) {
 const [busy,setBusy]=useState(false);
 const lock=useRef(false),attempt=useRef<{signature:string;key:string}|null>(null);
 const notice=useRef<string|null>(null);
 const current=useRef({user,onSaved});current.current={user,onSaved};
 const save=useCallback(async(enabled:boolean,city?:string)=>{
  if(lock.current)return;
  lock.current=true;setBusy(true);
  const body={enabled,...(enabled&&!current.current.user.approvedCityId?{cityId:city}:{})};const signature=JSON.stringify(body);
  if(attempt.current?.signature!==signature)attempt.current={signature,key:crypto.randomUUID()};
  if(notice.current&&notice.current!==`bloom-network-${current.current.user.id}`)toast.close(notice.current);
  const id=toast.add({id:`bloom-network-${current.current.user.id}`,title:'Saving Bloom opportunities…',type:'loading',timeout:0});notice.current=id;
  try{
   const result=await request<SessionUser>('/cleaner/network',{body,key:attempt.current.key});attempt.current=null;
   toast.update(id,{title:enabled?(result.bloomPoolStatus==='pending'?'Request to join Bloom sent':'Bloom opportunities enabled'):'Bloom opportunities turned off',description:enabled?(result.bloomPoolStatus==='pending'?'Your request is pending review. Your private work stays available.':'You’ll see available Bloom cleanings in your city.'):'Your private cleanings, accepted jobs, and earnings stay available.',type:'success',timeout:5000});
   notice.current=null;
   current.current.onSaved();window.dispatchEvent(new Event('bloom:payouts-changed'));
  }catch{
   toast.update(id,{title:'Couldn’t save your preference',description:'Your Bloom opportunities setting has not changed. Please try again.',type:'error',timeout:0,actionProps:{children:'Try again',onClick:()=>void save(enabled,city)}});
  }finally{lock.current=false;setBusy(false);}
 },[]);
 const choose=useCallback(()=>{
  if(notice.current)toast.close(notice.current);
  notice.current=toast.add({title:'Choose your Bloom city',description:'Choose a supported city to request Bloom opportunities. Your private work stays available.',type:'info',timeout:0,data:{content:<NetworkCity onJoin={city=>save(true,city)}/>}});
 },[save]);
 useEffect(()=>{
  const show=()=>{if(!current.current.user.approvedCityId&&current.current.user.bloomNetworkEnabled===false)choose();else toast.add({title:'Bloom opportunities',description:'Use the toggle beside Today to turn Bloom opportunities on or off.',type:'info'});};
  if(new URLSearchParams(location.search).get('network')==='1')show();
  window.addEventListener('bloom:network-settings',show);
  return()=>{window.removeEventListener('bloom:network-settings',show);if(notice.current)toast.close(notice.current);};
 },[choose]);
 const enabled=user.bloomNetworkEnabled!==false;
 return <button type="button" role="switch" aria-checked={enabled} aria-label="Bloom opportunities" disabled={busy||user.bloomPoolStatus==='pending'} className="bloom-network-trigger" data-enabled={enabled} onClick={()=>{if(!enabled&&!user.approvedCityId)choose();else void save(!enabled);}}><span className="bloom-network-indicator" data-enabled={enabled} aria-hidden="true"/>Bloom opportunities{user.bloomPoolStatus==='pending'?' · Pending approval':user.bloomPoolStatus==='rejected'?' · Declined — request again':user.bloomPoolStatus==='approved'&&!enabled?' · Approved':''}</button>;
}
