'use client';
import {useRef,useState,useEffect} from 'react';
import dynamic from 'next/dynamic';
import {findAddress,type AddressPin} from './geocode';
const JobMap=dynamic(()=>import('./job-map'),{ssr:false});
export function AddressPinPicker({address,value,onChange,showPreview=true}:{address:string;value:AddressPin|null;onChange:(pin:AddressPin|null)=>void;owner?:boolean;showPreview?:boolean}){
 const [results,setResults]=useState<AddressPin[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');const pending=useRef<AbortController|null>(null);
 useEffect(()=>()=>pending.current?.abort(),[]);
 const pin=value?.address===address?value:null;
 return <section className="bloom-pin-picker" aria-label="Find property on map">{/* A pin already chosen for this address (e.g. from address suggestions) needs no lookup. */}{!pin&&<button type="button" className="bloom-button secondary" disabled={busy||!address.trim()} onClick={async()=>{if(pending.current)return;const controller=new AbortController();pending.current=controller;setBusy(true);setMessage('');onChange(null);try{const matches=await findAddress(address,process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN??'',controller.signal);setResults(matches);if(matches.length===1&&matches[0].address===address)onChange(matches[0]);if(!matches.length)setMessage('No address match found. Check the address or continue without a pin.');}catch(error){if(!controller.signal.aborted)setMessage(error instanceof Error?error.message:'Address lookup failed.');}finally{pending.current=null;setBusy(false);}}}>{busy?'Finding address…':'Find on map'}</button>}{results.filter(r=>r.address===address).length>1&&results.filter(r=>r.address===address).map((result,index)=><button type="button" className="bloom-button secondary" key={index} aria-pressed={pin===result} onClick={()=>onChange(result)}>{result.label}</button>)}{pin&&showPreview&&<><p>{pin.label}</p><JobMap points={[{...pin,id:'address',label:pin.label}]} selected="address" onSelect={()=>{}} locate={false}/></>}{message&&<p role="status">{message}</p>}</section>;
}
