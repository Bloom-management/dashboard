'use client';
import {useState,useRef} from 'react';
import {AddressPinPicker} from '../maps/address-pin';
import type {AddressPin} from '../maps/geocode';
import {request} from './api';
import {ErrorNotice} from './primitives';
export function OwnerPinSuggestion({id,address,initial}:{id:string;address:string;initial:AddressPin|null}){
 const [pin,setPin]=useState(initial),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState<unknown>();const lock=useRef(false);
 return <section><h3>Property location</h3>{saved?<p role="status">Pin submitted for admin confirmation. Your listing is saved.</p>:<><AddressPinPicker address={address} value={pin} owner onChange={value=>{setPin(value);setConfirmed(false);}}/>{pin?.address===address&&<label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I checked that this pin marks my property.</label>}<button type="button" className="bloom-button secondary" disabled={busy||!confirmed||pin?.address!==address} onClick={async()=>{if(lock.current||!pin)return;lock.current=true;setBusy(true);setError(undefined);try{await request(`/owner/properties/${id}/pin-suggestion`,{body:{latitude:pin.latitude,longitude:pin.longitude,address,confirmed:true}});setSaved(true);}catch(e){setError(e);}finally{lock.current=false;setBusy(false);}}}>{busy?'Submitting…':'Submit pin for admin confirmation'}</button>{!!error&&<><p>Your listing remains saved. Retry submitting the pin.</p><ErrorNotice error={error}/></>}</>}</section>;
}
