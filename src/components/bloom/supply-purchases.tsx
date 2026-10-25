'use client';
import {useCallback,useRef,useState} from 'react';
import type {OwnerListing,OwnerSupply} from '../../contracts/owner-hub';
import type {SupplyPurchaseInput,SupplyPurchasePage} from '../../contracts/supply-purchases';
import {Select} from '../ui/select';
import {DatePicker} from './date-picker';
import {Modal,Loading,ErrorNotice,useResource} from './primitives';
import {ApiError,request} from './api';
import {formatDate,money,todayIn} from './dates';
import {SupplyIcon} from './supply-setup-grid';
import styles from './supply-purchases.module.css';

function ProductImage({url}:{url:string|null}){const [failed,setFailed]=useState(false);return <span className={styles.image}>{url&&!failed?<img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<SupplyIcon/>}</span>;}
export function SupplyPurchases({listing,supply,onClose,onSaved}:{listing:OwnerListing;supply:OwnerSupply;onClose:()=>void;onSaved:()=>void}){
 const path=`/properties/${listing.id}/supplies/${supply.supplyId}`;
 const [offset,setOffset]=useState(0);
 const load=useCallback((signal:AbortSignal)=>request<SupplyPurchasePage>(`${path}/purchases?offset=${offset}`,{signal}),[path,offset]);
 const history=useResource(load,true);
 const [form,setForm]=useState(false),[status,setStatus]=useState('purchased'),[linkOpen,setLinkOpen]=useState(false);
 const [productName,setProductName]=useState(supply.name),[productUrl,setProductUrl]=useState(''),[imageUrl,setImageUrl]=useState(''),[cost,setCost]=useState('');
 const [purchaseDate,setPurchaseDate]=useState(todayIn(listing.timezone)),[restockedDate,setRestockedDate]=useState(todayIn(listing.timezone));
 const [restockId,setRestockId]=useState<string>();
 const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[notice,setNotice]=useState('');
 const pending=useRef<{body:SupplyPurchaseInput|{restockId:string;restockedDate:string};key:string}|null>(null);
 const lock=useRef(false);
 const frozen=busy||!!pending.current;
 async function preview(){if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);setNotice('');try{
  const result=await request<{available:boolean;productName:string;imageUrl:string|null;costCents:number|null}>(`${path}/product-preview`,{body:{url:productUrl}});
  if(result.available){if(result.productName)setProductName(result.productName);if(result.imageUrl)setImageUrl(result.imageUrl);if(result.costCents!==null)setCost((result.costCents/100).toFixed(2));setNotice('Review the product details and enter the amount you actually paid.');}
  else setNotice('This store did not provide a preview. Enter the product details below.');
 }catch(e){setError(e);}finally{lock.current=false;setBusy(false);}}
 async function save(){if(lock.current)return;
  if(!pending.current){
   if(!restockId&&!/^\d{1,7}(\.\d{1,2})?$/.test(cost)){setNotice('Enter the purchase cost in dollars, such as 12.99.');return;}
   pending.current={key:crypto.randomUUID(),body:restockId?{restockId,restockedDate}:{productName,productUrl:productUrl.trim()||null,imageUrl:imageUrl.trim()||null,costCents:Math.round(Number(cost)*100),purchaseDate,restockedDate:status==='restocked'?restockedDate:null}};
  }
  lock.current=true;setBusy(true);setError(undefined);setNotice('');
  try{await request(`${path}/purchases`,{body:pending.current.body,key:pending.current.key});pending.current=null;setForm(false);setRestockId(undefined);setOffset(0);history.reload();onSaved();setNotice('Saved to restock history.');}
  catch(e){setError(e);if(e instanceof ApiError&&['VALIDATION_ERROR','FORBIDDEN','NOT_FOUND','CONFLICT'].includes(e.code))pending.current=null;}
  finally{lock.current=false;setBusy(false);}
 }
 return <Modal title={`${supply.name} purchases and restocks`} className={`detail-card ${styles.dialog}`} onClose={()=>{if(!busy&&!pending.current)onClose();}}>
 <h2>{supply.name}</h2><p>{listing.name}</p>
 {form||restockId?<form className={styles.form} onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={frozen}>
 {restockId?<h3>Mark as restocked</h3>:<><label>Status<Select value={status} onChange={e=>setStatus(e.target.value)}><option value="purchased">Purchased</option><option value="restocked">Purchased and restocked</option></Select></label>
 <button type="button" className={styles.ghost} onClick={()=>setLinkOpen(!linkOpen)}>{linkOpen?'Hide product link':'Add product link'}</button>
 {linkOpen&&<div className={styles.link}><label>Product link<input type="url" placeholder="https://…" maxLength={2048} value={productUrl} onChange={e=>setProductUrl(e.target.value)}/></label><button type="button" className={styles.ghost} disabled={!productUrl.trim()} onClick={()=>void preview()}>Get product details</button></div>}
 {imageUrl&&<ProductImage key={imageUrl} url={imageUrl}/>}
 <label>Product name<input required maxLength={200} value={productName} onChange={e=>setProductName(e.target.value)}/></label>
 <label>Cost paid (USD)<input required inputMode="decimal" placeholder="0.00" value={cost} onChange={e=>setCost(e.target.value)}/></label>
 <DatePicker variant="popover" label="Date purchased" value={purchaseDate} onChange={setPurchaseDate}/>
 <details><summary>Product image</summary><label>Image link (optional)<input type="url" maxLength={2048} value={imageUrl} onChange={e=>setImageUrl(e.target.value)}/></label></details></>}
 {(restockId||status==='restocked')&&<DatePicker label="Date restocked at the property" value={restockedDate} onChange={setRestockedDate}/>}
 </fieldset>
 <div className={styles.actions}><button type="button" className={styles.ghost} disabled={frozen} onClick={()=>{setForm(false);setRestockId(undefined);}}>Cancel</button><button className="bloom-button" disabled={busy}>{busy?'Saving…':pending.current?'Retry save':'Save'}</button></div>
 {!!pending.current&&!busy&&<p>Saving could not be confirmed. Retry to avoid recording this purchase twice.</p>}
 </form>:<button type="button" className={styles.ghost} onClick={()=>{setForm(true);setNotice('');setError(undefined);}}>Record a purchase</button>}
 {notice&&<p role="status">{notice}</p>}{!!error&&<ErrorNotice error={error}/>}
 <h3>Purchase and restock history</h3>
 {history.loading?<Loading/>:history.error?<ErrorNotice error={history.error} retry={history.reload}/>:!history.data?.items.length?<p>No purchases or restocks recorded yet.</p>:<><ul className={styles.history}>{history.data.items.map(item=><li className={styles.card} key={item.id}><div className={styles.product}><ProductImage key={item.imageUrl} url={item.imageUrl}/><div><strong>{item.productName}</strong><p>{money(item.costCents)} · Purchased {formatDate(item.purchaseDate)}</p><p>{item.restockedDate?`Restocked ${formatDate(item.restockedDate)}`:'Purchased · Not restocked yet'}</p><small>Recorded by {item.recordedBy}</small></div></div><div className={styles.actions}>{item.productUrl&&<a className={styles.ghost} href={item.productUrl} target="_blank" rel="noopener noreferrer">View product ↗</a>}{!item.restockedDate&&<button type="button" className={styles.ghost} disabled={frozen} onClick={()=>{setForm(false);setRestockId(item.id);setRestockedDate(todayIn(listing.timezone));}}>Mark restocked</button>}</div></li>)}</ul><nav className={styles.actions} aria-label="Purchase history pages"><button type="button" className={styles.ghost} disabled={offset===0||frozen} onClick={()=>setOffset(Math.max(0,offset-20))}>Previous</button><button type="button" className={styles.ghost} disabled={history.data.nextOffset===null||frozen} onClick={()=>setOffset(history.data!.nextOffset!)}>Next</button></nav></>}
 </Modal>;
}
