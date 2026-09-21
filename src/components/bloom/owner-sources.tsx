'use client';
import { useRef, useState } from 'react';
import type { OwnerListing, OwnerSource } from '../../contracts/owner-hub';
import type { SyncResult } from '../../contracts';
import { ApiError, request } from './api';
import { ErrorNotice } from './primitives';
import { CalendarSetupCard } from './supply-setup-grid';

/** An explicit calendar error envelope means the server attempted failure bookkeeping.
 * A transport/malformed-response failure can hide a successful commit, so replay its key. */
export function retainOwnerSourceReceipt(action: 'add' | 'sync', failure: unknown): boolean {
 if (!(failure instanceof ApiError)) return true;
 if (action === 'sync' && failure.code === 'SOURCE_UNAVAILABLE' && failure.requestId) return false;
 return ['NETWORK_ERROR','SOURCE_UNAVAILABLE','SERVICE_UNAVAILABLE'].includes(failure.code);
}

export function OwnerSources({listing,onChanged}:{listing:OwnerListing;onChanged:()=>void}){
 const [provider,setProvider]=useState<'airbnb'|'vrbo'>('airbnb');
 const [addConflict,setAddConflict]=useState(false);
 const [url,setUrl]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState<unknown>();const [result,setResult]=useState('');
 const lock=useRef(false);const receipt=useRef<{input:string;key:string}|null>(null);
 async function mutate(action:'add'|'sync',source?:OwnerSource){
  if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);setAddConflict(false);setResult('');
  const input=JSON.stringify({action,propertyId:listing.id,sourceId:source?.id,provider,url:action==='add'?url:undefined});
  if(receipt.current?.input!==input)receipt.current={input,key:crypto.randomUUID()};
  try{
   const path=`/owner/properties/${encodeURIComponent(listing.id)}/calendar-sources`;
   if(action==='add'){await request<OwnerSource>(path,{body:provider==='airbnb'?{url}:{url,provider},key:receipt.current.key});setUrl('');setResult(`${provider==='airbnb'?'Airbnb':'Vrbo'} link saved. Choose Sync now to import its calendar.`);}
   else{const synced=await request<SyncResult&{status:'success'|'partial'|'not_modified'}>(`${path}/${encodeURIComponent(source!.id)}/sync`,{body:{},key:receipt.current.key});setResult(synced.status==='partial'?'The export was incomplete. Existing stays were preserved; check source status.':synced.status==='not_modified'?'Calendar unchanged.':`Synced calendar entries: ${synced.created} added, ${synced.updated} updated, ${synced.removed} removed. These counts describe calendar entries.`);}
   receipt.current=null;onChanged();
  }catch(failure){setError(failure);setAddConflict(action==='add'&&failure instanceof ApiError&&failure.code==='CONFLICT');if(!retainOwnerSourceReceipt(action,failure))receipt.current=null;}
  finally{lock.current=false;setBusy(false);}
 }
 return <section aria-label={`${listing.name} calendar connection`}><h3>Calendar connection</h3>{listing.sources.length?listing.sources.map(source=><div className="owner-source" key={source.id}><strong>{source.provider==='airbnb'?'Airbnb':'Vrbo'}</strong><p>{source.enabled?'Enabled':'Disabled'} · Last successful sync: {source.lastSuccessAt?new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:listing.timezone}).format(new Date(source.lastSuccessAt)):'Not yet synced'}</p>{source.message&&<p className="bloom-notice">{source.message}</p>}{<button type="button" className="bloom-button secondary" disabled={busy||!source.enabled} onClick={()=>void mutate('sync',source)}>{busy?'Working…':'Sync now'}</button>}</div>):<p>No calendar sources connected.</p>}
 <form className="bloom-form" onSubmit={event=>{event.preventDefault();void mutate('add');}}><CalendarSetupCard provider={provider} url={url} onProvider={setProvider} onUrl={setUrl} required disabled={busy}/><p>Use the provider’s calendar export link (iCal) from availability settings, not the public listing URL. This link connects only to {listing.name}. It is stored privately and never displayed in the source list. Saving a link does not import stays until you sync. If sync fails, the listing stays saved; retry the sync.</p><button className="bloom-button" disabled={busy||!url.trim()}>{busy?'Working…':provider==='airbnb'?'Connect Airbnb calendar':'Connect Vrbo calendar'}</button></form>{!!error&&<ErrorNotice error={error}/>} {addConflict&&<p className="bloom-notice">The calendar connection could not be updated. Refresh the listing and check its saved calendars before retrying.</p>}<p role="status">{result}</p></section>;
}
