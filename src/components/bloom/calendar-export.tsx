'use client';
import {useCallback,useRef,useState} from 'react';
import {request} from './api';
import {ErrorNotice,Loading,useResource} from './primitives';

type ExportStatus={enabled:boolean;url:string|null;lastFetchedAt:string|null;ownerConfirmedAt:string|null};
type Action='create'|'regenerate'|'disable'|'confirm';

/** Mount with key={propertyId}: a subscription URL belongs to exactly one property. */
export function CalendarExport({propertyId}:{propertyId:string}){
 const path=`/properties/${encodeURIComponent(propertyId)}/calendar-export`;
 const load=useCallback((signal:AbortSignal)=>request<ExportStatus>(path,{signal}),[path]);
 const resource=useResource(load);
 return <section className="bloom-admin-card" aria-label="Export from Bloom"><h3>Share Bloom availability</h3><p>Share this property’s active manual/direct bookings with Airbnb. Cleaning jobs and imported Airbnb or Vrbo bookings are not exported. The calendar contains only reserved dates, with checkout available for the next arrival.</p>{resource.loading?<Loading/>:resource.error?<ErrorNotice error={resource.error} retry={resource.reload}/>:resource.data?<ExportControls key={propertyId} initial={resource.data} path={path}/>:null}</section>;
}

function ExportControls({initial,path}:{initial:ExportStatus;path:string}){
 const [state,setState]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[message,setMessage]=useState(''),[danger,setDanger]=useState<'regenerate'|'disable'|null>(null),[ack,setAck]=useState(false);
 const lock=useRef(false),receipt=useRef<{action:Action;key:string}|null>(null);
 async function mutate(action:Action){
  if(lock.current)return;
  lock.current=true;setBusy(true);setError(undefined);setMessage('');
  if(receipt.current?.action!==action)receipt.current={action,key:crypto.randomUUID()};
  try{const result=await request<ExportStatus>(path,{body:{action},key:receipt.current.key});setState(result);receipt.current=null;setDanger(null);setAck(false);setMessage(action==='confirm'?'Setup marked complete by you. Airbnb availability has not been verified.':action==='disable'?'Calendar link disabled. Remove the old subscription in Airbnb.':action==='regenerate'?'New link created. Reconnect it in Airbnb.':'Calendar link ready. Connect it in Airbnb below.');}
  catch(failure){setError(failure);}
  finally{lock.current=false;setBusy(false);}
 }
 async function copy(){try{await navigator.clipboard.writeText(state.url!);setMessage('Calendar link copied. Follow the Airbnb setup steps below.');}catch{setMessage('Could not copy automatically. Select and copy the calendar link below.');}}
 return <div className="bloom-form">
  <p>{state.ownerConfirmedAt?'You marked export setup complete.':'Export setup not confirmed.'} {state.lastFetchedAt?`Feed last fetched ${new Date(state.lastFetchedAt).toLocaleString()}.`:'No feed fetch recorded.'} A fetch or a copied link does not confirm that Airbnb applied these dates.</p>
  {state.enabled&&state.url?<><label>Private subscription link<input readOnly value={state.url} onFocus={event=>event.currentTarget.select()} autoComplete="off"/></label><p>Anyone with this link can read reserved dates. Share it only with your calendar provider.</p><div className="bloom-export-actions"><button type="button" className="bloom-button" disabled={busy} onClick={()=>void copy()}>Copy calendar link</button><button type="button" className="bloom-button secondary" disabled={busy} onClick={()=>{setDanger('regenerate');setAck(false);}}>Regenerate link</button><button type="button" className="bloom-button secondary" disabled={busy} onClick={()=>{setDanger('disable');setAck(false);}}>Disable link</button></div></>:<button type="button" className="bloom-button" disabled={busy} onClick={()=>void mutate('create')}>{busy?'Working…':'Create calendar link'}</button>}
  {danger&&<div className="bloom-notice"><p>{danger==='regenerate'?'The old link will stop working. You must replace the subscription link in Airbnb and any other connected calendar.':'This stops future feed access. It does not immediately remove dates already imported into Airbnb; remove that subscription there.'}</p><label><input type="checkbox" checked={ack} onChange={event=>setAck(event.target.checked)}/>I understand that I must update Airbnb’s calendar connection.</label><div className="bloom-export-actions"><button type="button" className="bloom-button" disabled={!ack||busy} onClick={()=>void mutate(danger)}>{busy?'Working…':danger==='regenerate'?'Confirm regeneration':'Confirm disable'}</button><button type="button" className="bloom-button secondary" disabled={busy} onClick={()=>setDanger(null)}>Cancel</button></div></div>}
  <details><summary>Connect to Airbnb</summary><ol><li>Copy this Bloom calendar link.</li><li>In Airbnb, open this listing’s Calendar, then Availability → Connect calendars → Connect to another website.</li><li>Paste the Bloom link into the calendar address field, name it Bloom, and choose Add calendar. Keep the existing Airbnb-to-Bloom import connection.</li><li>Refresh and check the intended nights in Airbnb. The checkout date remains available for a new arrival.</li></ol><p>Syncing is not immediate. Edits and cancellations depend on Airbnb refreshing and applying the feed. Check Airbnb availability for urgent or last-minute bookings; Bloom cannot confirm provider-side blocking from a feed request.</p><a href="https://www.airbnb.com/help/article/99" target="_blank" rel="noreferrer">Airbnb calendar connection instructions</a>{state.enabled&&<button type="button" className="bloom-button secondary" disabled={busy||!!state.ownerConfirmedAt} onClick={()=>void mutate('confirm')}>I completed setup in Airbnb</button>}</details>
  {!!error&&<ErrorNotice error={error}/>}<p role="status">{message}</p>
  <style>{`.bloom-export-actions{display:flex;gap:12px;flex-wrap:wrap}.bloom-export-actions .bloom-button{max-width:100%}`}</style>
 </div>;
}
