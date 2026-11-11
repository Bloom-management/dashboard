'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {PropertyCover} from '../../server/properties/airbnb-cover';
import {request,ApiError} from './api';
import {ErrorNotice,Icon,Loading,useResource} from './primitives';
function changed(id:string){
 window.dispatchEvent(new CustomEvent('bloom:property-cover',{detail:id}));
 try{localStorage.setItem('bloom:property-cover',JSON.stringify({id,at:Date.now()}));}catch{}
}
function useCover(id:string){
 const load=useCallback((signal:AbortSignal)=>request<PropertyCover>('/properties/'+id+'/airbnb',{signal}),[id]);
 const data=useResource(load,true);
 useEffect(()=>{
  const local=(event:Event)=>{if((event as CustomEvent).detail===id)data.reload();};
  const storage=(event:StorageEvent)=>{if(event.key==='bloom:property-cover')data.reload();};
  const focus=()=>data.reload();
  window.addEventListener('bloom:property-cover',local);window.addEventListener('storage',storage);window.addEventListener('focus',focus);
  const timer=setInterval(()=>{if(document.visibilityState==='visible')data.reload();},60000);
  return()=>{window.removeEventListener('bloom:property-cover',local);window.removeEventListener('storage',storage);window.removeEventListener('focus',focus);clearInterval(timer);};
 },[id,data.reload]);return data;
}
function ThumbnailImage({src}:{src:string}){
 const [failed,setFailed]=useState(false);
 return failed?<Icon name="pin"/>:<img src={src} alt="" width={44} height={44} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)} style={{display:'block',objectFit:'cover',borderRadius:12,flexShrink:0}}/>;
}
/** Cover thumbnail. `placeholder={false}` renders nothing without a cover, so cards keep their plain layout. */
export function PropertyThumbnail({id,placeholder=true}:{id:string;placeholder?:boolean}){
 const data=useCover(id);
 if(!placeholder&&!data.data?.image)return null;
 return <span style={{display:'grid',placeItems:'center',width:44,height:44,flexShrink:0,borderRadius:12,overflow:'hidden'}}>{data.data?.image?<ThumbnailImage key={data.data.image+':'+data.data.revision} src={data.data.image}/>:<Icon name="pin"/>}</span>;
}
export function PropertyThumbnailSettings({id}:{id:string}){
 const data=useCover(id);
 return <section className="bloom-admin-card"><h3>Airbnb listing and cover photo</h3>
 {data.loading&&!data.data?<Loading/>:data.error?<ErrorNotice error={data.error} retry={data.reload}/>:data.data?.canEdit?<CoverForm key={id+':'+data.data.revision} id={id} value={data.data} reload={data.reload}/>:<p>You don’t have permission to edit this property.</p>}
 </section>;
}
function CoverForm({id,value,reload}:{id:string;value:PropertyCover;reload:()=>void}){
 const [url,setUrl]=useState(value.listingUrl??''),[manual,setManual]=useState(value.status==='manual'?value.image??'':''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
 const [manualOpen,setManualOpen]=useState(value.status==='manual');
 const pending=useRef<{body:{listingUrl:string|null;manualImageUrl:string|null;revision:number};key:string}|null>(null),lock=useRef(false);
 async function save(retry=false){
  if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);
  const body={listingUrl:url.trim()||null,manualImageUrl:retry?null:manual.trim()||null,revision:value.revision};
  pending.current??={body,key:crypto.randomUUID()};
  try{await request('/properties/'+id+'/airbnb',{body:pending.current.body,key:pending.current.key});pending.current=null;changed(id);reload();}
  catch(e){setError(e);if(e instanceof ApiError&&!['NETWORK_ERROR','SERVICE_UNAVAILABLE','CONFIGURATION_ERROR'].includes(e.code))pending.current=null;}
  finally{lock.current=false;setBusy(false);}
 }
 return <form className="bloom-form" onSubmit={e=>{e.preventDefault();void save();}}>
 <fieldset disabled={busy||!!pending.current}><label>Airbnb listing URL<input type="url" maxLength={2048} placeholder="https://www.airbnb.com/rooms/…" value={url} onChange={e=>{setUrl(e.target.value);setManual('');}}/></label>
 <details open={manualOpen} onToggle={e=>setManualOpen(e.currentTarget.open)}><summary>Use a manual cover image URL</summary><label>Airbnb image URL<input type="url" maxLength={2048} placeholder="https://a0.muscache.com/…" value={manual} onChange={e=>setManual(e.target.value)}/></label><p>Paste the direct Airbnb cover image URL if automatic extraction is unavailable.</p></details></fieldset>
 {value.image&&url.trim()===value.listingUrl&&<img src={value.image} alt="Property cover preview" width={128} height={96} referrerPolicy="no-referrer" style={{objectFit:'cover',borderRadius:12}} onError={e=>{e.currentTarget.style.display='none';}}/>}
 {value.status==='unavailable'&&url.trim()===value.listingUrl&&<p role="status">Listing saved. Airbnb did not provide a cover photo. Retry extraction or add a manual image URL.</p>}
 <div className="bloom-actions"><button type="submit" className="bloom-button" disabled={busy}>{busy?'Saving…':pending.current?'Retry save':'Save Airbnb listing'}</button>
 {value.listingUrl&&<button type="button" className="bloom-button secondary" disabled={busy||!!pending.current||url.trim()!==value.listingUrl} onClick={()=>void save(true)}>Retry cover extraction</button>}</div>
 {!!error&&<ErrorNotice error={error} retry={error instanceof ApiError&&error.code==='CONFLICT'?reload:()=>void save()}/>}
 </form>;
}
