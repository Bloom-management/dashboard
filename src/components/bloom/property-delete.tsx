'use client';
import { useRef, useState } from 'react';
import { ApiError, request } from './api';
import { ErrorNotice, Modal } from './primitives';

export function PropertyDelete({property,onDeleted,iconOnly=false}:{property:{id:string;name:string};onDeleted:()=>void;iconOnly?:boolean}){
 const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
 const key=useRef<string|null>(null),locked=useRef(false);
 async function remove(){
  if(locked.current)return;locked.current=true;setBusy(true);setError(undefined);
  key.current??=crypto.randomUUID();
  try{await request(`/properties/${encodeURIComponent(property.id)}/delete`,{body:{},key:key.current});setConfirm(false);onDeleted();}
  catch(failure){setError(failure);if(failure instanceof ApiError&&failure.code==='CONFLICT')key.current=null;}
  finally{locked.current=false;setBusy(false);}
 }
 return <><button type="button" className={iconOnly?'icon-btn property-delete-trigger':'bloom-button secondary'} aria-label="Delete listing" title="Delete listing" onClick={()=>{setError(undefined);setConfirm(true);}}>{iconOnly?<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>:'Delete listing'}</button>{confirm&&<Modal className="property-delete-dialog" title={`Delete ${property.name}?`} onClose={()=>{if(!busy)setConfirm(false);}}><div className="property-delete-message"><h2>Delete {property.name}?</h2><p>This removes the listing from active views, stops its calendar syncing, and cancels unassigned open cleanings. Booking and completed-cleaning history is retained.</p><p>If cleaners are assigned to an open job, an admin must cancel or resolve that job before deletion.</p><div className="bloom-actions"><button type="button" className="bloom-button" disabled={busy} onClick={()=>void remove()}>{busy?'Deleting…':'Confirm deletion'}</button><button type="button" className="bloom-button secondary" disabled={busy} onClick={()=>setConfirm(false)}>Keep listing</button></div>{!!error&&(error instanceof ApiError&&error.code==='CONFLICT'?<p role="alert">This listing has an assigned open cleaning. Ask an admin to cancel or resolve it, then try again.</p>:<ErrorNotice error={error}/>)}</div></Modal>}</>;
}
