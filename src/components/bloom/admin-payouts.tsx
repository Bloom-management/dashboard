'use client';
import {Select} from '../ui/select';

import {createContext,useContext,useCallback,useRef,useState,type FormEvent} from 'react';
import {paymentMethods,type PaymentMethod,type PayoutSummary,type PayoutDetail,type PayoutCleaning,type PayoutPayment} from '../../contracts/payouts';
import {request} from './api';
import {Modal,Loading,ErrorNotice,useResource} from './primitives';
import {DatePicker} from './date-picker';
import {money,formatDate} from './dates';
import './admin-payouts.css';

export function payoutCents(value:string):number|null {
  if(!/^-?\d+(?:\.\d{1,2})?$/.test(value.trim()))return null;
  const negative=value.trim().startsWith('-');const [whole,fraction='']=value.trim().replace('-','').split('.');
  const result=(Number(whole)*100+Number(fraction.padEnd(2,'0')))*(negative?-1:1);
  return Number.isSafeInteger(result)?result:null;
}
function usePayoutMutation(){
  const[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
  const lock=useRef(false),receipt=useRef<{input:string;key:string}|null>(null);
  async function run(path:string,body:unknown,done:()=>void){
    if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);
    const input=JSON.stringify([path,body]);if(receipt.current?.input!==input)receipt.current={input,key:crypto.randomUUID()};
    try{await request(path,{body,key:receipt.current.key});receipt.current=null;window.dispatchEvent(new Event('bloom:payouts-changed'));done();}catch(error){setError(error);}finally{lock.current=false;setBusy(false);}
  }
  return{busy,error,run};
}
const PayoutScope=createContext<'admin'|'owner'>('admin');
function usePayoutBase(){const scope=useContext(PayoutScope);return useCallback((id:string)=>`/${scope}/payouts/${encodeURIComponent(id)}`,[scope]);}
const timestamp=(value:string)=>new Date(value).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'});
function MethodSelect({value,onChange,optional=false,label='Method'}:{value:string;onChange:(value:string)=>void;optional?:boolean;label?:string}){
  return <Select aria-label={label} value={value} required={!optional} onChange={event=>onChange(event.target.value)}><option value="">{optional?'Not set':'Choose method'}</option>{paymentMethods.map(method=><option key={method}>{method}</option>)}</Select>;
}
export function AdminPayouts(props:{initialCleanerId?:string|null;onCloseLinkedCleaner?:()=>void;scope?:'admin'|'owner'}={}){return <PayoutScope.Provider value={props.scope??'admin'}><PayoutsContent {...props}/></PayoutScope.Provider>;}
function PayoutsContent({initialCleanerId=null,onCloseLinkedCleaner}:{initialCleanerId?:string|null;onCloseLinkedCleaner?:()=>void}){
  const scope=useContext(PayoutScope);
  const load=useCallback((signal:AbortSignal)=>request<PayoutSummary>(`/${scope}/payouts`,{signal}),[scope]),data=useResource(load);
  const[search,setSearch]=useState(''),[outstanding,setOutstanding]=useState(false),[selected,setSelected]=useState<string|null>(initialCleanerId);
  const people=data.data?.people.filter(person=>(!outstanding||person.totalDueCents>0)&&person.name.toLowerCase().includes(search.trim().toLowerCase()))??[];
  return <section className="admin-payouts" aria-label="Cleaner payouts"><p>{scope==='owner'?'Amounts you owe your private cleaners. ':'Bloom-paid cleaning earnings. '}Track completed earnings and payments made outside Bloom. Recording a payment does not transfer money.</p>
    {data.loading?<Loading/>:data.error?<ErrorNotice error={data.error} retry={data.reload}/>:data.data&&<>
      <div className="payout-summary"><span>Total outstanding</span><strong>{money(data.data.totalOutstandingCents)}</strong><small>All unpaid completed work · USD · All time</small></div>
      {!!data.data.reviewCount&&<p className="bloom-notice">{data.data.reviewCount} completed cleaning {data.data.reviewCount===1?'entry needs':'entries need'} payout review. Unknown earnings are excluded from the total.{data.data.unassignedReviewCount>0&&` ${data.data.unassignedReviewCount} could not be linked to a cleaner.`}</p>}
      <div className="payout-toolbar"><label>Search cleaners<input type="search" placeholder="Search by name" value={search} onChange={event=>setSearch(event.target.value)}/></label><label className="payout-check"><input type="checkbox" checked={outstanding} onChange={event=>setOutstanding(event.target.checked)}/>Outstanding only</label><button className="bloom-button secondary" onClick={data.reload}>Refresh</button></div>
      <div className="payout-table-wrap"><table className="payout-table"><thead><tr><th scope="col">Name</th><th scope="col">Amount due</th><th scope="col">Method</th></tr></thead><tbody>{people.map(person=><tr key={person.id} onClick={()=>setSelected(person.id)}><th scope="row"><button className="payout-person" onClick={()=>setSelected(person.id)}>{person.name}</button>{person.reviewCount>0&&<small className="payout-review">{person.reviewCount} need review</small>}</th><td>{money(person.totalDueCents)}</td><td>{person.preferredMethod??'Not set'}</td></tr>)}</tbody></table>{!people.length&&<p className="payout-empty">No cleaners match these filters.</p>}</div>
    </>}{selected&&<Modal className="cleaner-day-dialog payout-dialog" title="Cleaner payout details" onClose={()=>{setSelected(null);if(initialCleanerId)onCloseLinkedCleaner?.();}}><PayoutDetails id={selected} onChanged={data.reload}/></Modal>}
  </section>;
}
function PayoutDetails({id,onChanged}:{id:string;onChanged:()=>void}){
  const base=usePayoutBase();
  const load=useCallback((signal:AbortSignal)=>request<PayoutDetail>(base(id),{signal}),[id,base]),resource=useResource(load);
  const payment=usePayoutMutation();
  function confirmPayment(detail:PayoutDetail,cleaning?:PayoutCleaning){
    if(!detail.preferredMethod){setMode('preference');setMessage('Choose a preferred payment method first, then confirm payment.');return;}
    const balances=(cleaning?[cleaning]:detail.cleanings).filter(item=>item.status!=='review'&&(item.remainingCents??0)>0);
    const amountCents=balances.reduce((sum,item)=>sum+(item.remainingCents??0),0);
    if(!amountCents)return;
    const now=new Date(),paymentDate=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    void payment.run(`${base(id)}/payments`,{amountCents,method:detail.preferredMethod,paymentDate,allocations:balances.map(item=>({cleaningId:item.id,amountCents:item.remainingCents}))},()=>reload('Payment confirmed.'));
  }
  const[mode,setMode]=useState<'payment'|'preference'|null>(null),[message,setMessage]=useState('');
  const reload=(notice:string)=>{setMode(null);setMessage(notice);resource.reload();onChanged();};
  return <div className="admin-payouts">{resource.loading?<Loading/>:resource.error?<ErrorNotice error={resource.error} retry={resource.reload}/>:resource.data&&<>
    <header className="payout-detail-heading"><p className="payout-eyebrow">Completed cleaning earnings</p><h2>{resource.data.name}</h2><div className="payout-detail-totals"><div><span>Total due</span><strong>{money(resource.data.totalDueCents)}</strong></div><div><span>Preferred method</span><strong>{resource.data.preferredMethod??'Not set'}</strong></div></div></header>
    <div className="payout-actions"><button className="bloom-button" disabled={payment.busy||resource.data.totalDueCents<=0} onClick={()=>confirmPayment(resource.data!)}>{payment.busy?'Confirming…':'Confirm payment made'}</button><button className="bloom-button secondary" disabled={payment.busy} onClick={()=>setMode(mode==='payment'?null:'payment')}>Edit / adjust</button><button className="bloom-button secondary" onClick={()=>setMode(mode==='preference'?null:'preference')}>Edit preferred method</button></div>
    {!!payment.error&&<ErrorNotice error={payment.error}/>} {message&&<p role="status">{message}</p>}{mode==='payment'&&<PaymentForm detail={resource.data} done={()=>reload('External payment recorded. No money was transferred by Bloom.')} cancel={()=>setMode(null)}/>}{mode==='preference'&&<PreferenceForm detail={resource.data} done={()=>reload('Preferred method saved. Past payments keep their recorded method.')} cancel={()=>setMode(null)}/>}
    <section className="payout-section"><h3>Completed cleanings</h3><p>All time. Each cleaning keeps its finalized earnings; unfinished work is excluded.</p>{resource.data.cleanings.length?resource.data.cleanings.map(cleaning=><CleaningCard key={cleaning.id} cleanerId={id} cleaning={cleaning} paymentBusy={payment.busy} confirmPayment={()=>confirmPayment(resource.data!,cleaning)} done={()=>reload('Adjustment recorded. Original earnings are preserved.')}/>):<p>No completed cleanings yet.</p>}</section>
    <section className="payout-section"><h3>Payment history</h3>{resource.data.payments.length?resource.data.payments.map(payment=><PaymentCard key={payment.id} cleanerId={id} payment={payment} done={()=>reload('Payment voided. Its cleaning balances are available again. Record a replacement payment if needed.')}/>):<p>No external payments recorded.</p>}</section>
  </>}</div>;
}
function PreferenceForm({detail,done,cancel}:{detail:PayoutDetail;done:()=>void;cancel:()=>void}){
  const base=usePayoutBase();
  const[value,setValue]=useState<string>(detail.preferredMethod??''),mutation=usePayoutMutation();
  return <form className="payout-form" onSubmit={event=>{event.preventDefault();void mutation.run(`${base(detail.id)}/preference`,{method:value||null},done);}}><fieldset disabled={mutation.busy}><legend>Preferred payment method</legend><label>Method<MethodSelect optional value={value} onChange={setValue}/></label><p>This is a default for new records. It does not change previous payments.</p><FormActions busy={mutation.busy} label="Save preferred method" cancel={cancel}/></fieldset>{!!mutation.error&&<ErrorNotice error={mutation.error}/>}</form>;
}
function FormActions({busy,label,cancel,disabled=false}:{busy:boolean;label:string;cancel:()=>void;disabled?:boolean}){return <div className="payout-actions"><button className="bloom-button" disabled={busy||disabled}>{busy?'Saving…':label}</button><button type="button" className="bloom-button secondary" disabled={busy} onClick={cancel}>Cancel</button></div>;}
function PaymentForm({detail,initialCleaning,done,cancel}:{detail:PayoutDetail;initialCleaning?:PayoutCleaning;done:()=>void;cancel:()=>void}){
  const base=usePayoutBase();
  const[amount,setAmount]=useState(initialCleaning?((initialCleaning.remainingCents??0)/100).toFixed(2):''),[method,setMethod]=useState<string>(detail.preferredMethod??''),[date,setDate]=useState(()=>{const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;}),[note,setNote]=useState(''),[confirmed,setConfirmed]=useState(false);
  const mutation=usePayoutMutation(),balances=detail.cleanings.filter(cleaning=>(cleaning.remainingCents??0)>0&&cleaning.status!=='review');
  const cents=payoutCents(amount);
  let remaining=cents??0;
  const allocations:Record<string,string>={};
  for(const cleaning of [...balances].filter(item=>!initialCleaning||item.id===initialCleaning.id).sort((a,b)=>a.cleaningDate.localeCompare(b.cleaningDate)||a.id.localeCompare(b.id))){
    const paid=Math.min(Math.max(remaining,0),cleaning.remainingCents??0);
    if(paid>0){allocations[cleaning.id]=(paid/100).toFixed(2);remaining-=paid;}
  }
  const entries=Object.entries(allocations),total=entries.reduce((sum,[,value])=>sum+(payoutCents(value)??0),0);
  const valid=entries.length>0&&entries.every(([id,value])=>{const valueCents=payoutCents(value);return valueCents!==null&&valueCents>0&&valueCents<=(balances.find(item=>item.id===id)?.remainingCents??0);})&&cents!==null&&cents>0&&total===cents&&!!method&&!!date&&confirmed;
  function submit(event:FormEvent){event.preventDefault();if(!valid)return;void mutation.run(`${base(detail.id)}/payments`,{amountCents:cents,method:method as PaymentMethod,paymentDate:date,note:note.trim()||undefined,allocations:entries.map(([cleaningId,value])=>({cleaningId,amountCents:payoutCents(value)}))},done);}
  return <form className="payout-form" onSubmit={submit}><fieldset disabled={mutation.busy}><legend>Record an external payment</legend><p>For extra pay or a reduction, use Edit / adjust on the cleaning below first. Use this form only to record a partial payment or change payment details.</p>
    <div className="payout-form-grid"><label>Payment amount (USD)<input inputMode="decimal" required value={amount} onChange={event=>setAmount(event.target.value)}/></label><label>Actual payment method<MethodSelect label="Actual payment method" value={method} onChange={setMethod}/></label><DatePicker label="Payment date" value={date} onChange={setDate}/><label>Transaction reference or note (optional)<textarea maxLength={1000} value={note} onChange={event=>setNote(event.target.value)}/></label></div><p>Payments cover the oldest unpaid cleanings first.</p>{cents!==null&&cents>total&&<p role="status">This exceeds the unpaid balance. Add an earnings adjustment to the cleaning before recording extra pay.</p>}<label className="payout-check"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>I confirm this payment was made outside Bloom. Saving only records it; no money will be transferred.</label><FormActions busy={mutation.busy} label="Confirm payment made" disabled={!valid} cancel={cancel}/></fieldset>{!!mutation.error&&<ErrorNotice error={mutation.error}/>}</form>;
}
function CleaningCard({cleanerId,cleaning,confirmPayment,done,paymentBusy=false}:{paymentBusy?:boolean;cleanerId:string;cleaning:PayoutCleaning;confirmPayment:()=>void;done:()=>void}){
  const base=usePayoutBase();
  const[adjust,setAdjust]=useState(false),[amount,setAmount]=useState(''),[reason,setReason]=useState(''),mutation=usePayoutMutation();const cents=payoutCents(amount);
  return <article className="payout-cleaning" aria-label={`${cleaning.propertyName} ${cleaning.cleaningDate}`}><div className="payout-card-heading"><div><h4>{cleaning.propertyName}</h4><p>{formatDate(cleaning.cleaningDate)} · {cleaning.participation==='solo'?'Solo':'Shared'} participation</p></div><span className={`payout-status ${cleaning.status}`}>{({unpaid:'Unpaid',partial:'Partially paid',paid:'Paid',review:'Needs review'})[cleaning.status]}</span></div>
    {cleaning.status==='review'?<p className="bloom-notice">{cleaning.reviewReason??'No reliable finalized payout snapshot. An admin must review the source record before this work can be paid.'}</p>:<dl className="payout-amounts"><div><dt>Finalized earnings</dt><dd>{money(cleaning.originalEarningsCents??0)}</dd></div><div><dt>Adjustments</dt><dd>{money(cleaning.adjustmentCents)}</dd></div><div><dt>Paid</dt><dd>{money(cleaning.paidCents)}</dd></div><div><dt>Remaining</dt><dd>{money(cleaning.remainingCents??0)}</dd></div></dl>}
    {cleaning.comments&&<div className="payout-comments"><h5>Completion comments</h5><p>{cleaning.comments}</p></div>}{cleaning.adjustments.length>0&&<details><summary>Adjustment history ({cleaning.adjustments.length})</summary>{cleaning.adjustments.map(adjustment=><div className="payout-audit" key={adjustment.id}><strong>{money(adjustment.amountCents)}</strong><p>{adjustment.reason}</p><small>{adjustment.enteredBy} · {timestamp(adjustment.createdAt)}</small></div>)}</details>}
    <div className="payout-actions">{cleaning.status!=='review'&&(cleaning.remainingCents??0)>0&&<button className="bloom-button secondary" disabled={paymentBusy} onClick={confirmPayment}>Confirm payment made</button>}
    {cleaning.status!=='review'&&!adjust&&<button className="bloom-button secondary" onClick={()=>setAdjust(true)}>Edit / adjust</button>}</div>{adjust&&<form className="payout-form" onSubmit={event=>{event.preventDefault();if(cents===null||cents===0||!reason.trim())return;void mutation.run(`${base(cleanerId)}/adjustments`,{cleaningId:cleaning.id,amountCents:cents,reason:reason.trim()},()=>{setAdjust(false);done();});}}><fieldset disabled={mutation.busy}><legend>Adjust this cleaning</legend><p>Add extra pay for more time or a deep clean, or reduce pay for a correction. Enter a positive amount to add pay or a negative amount to subtract it. Save the adjustment, then confirm payment.</p><label>Adjustment (USD)<input required inputMode="decimal" value={amount} onChange={event=>setAmount(event.target.value)}/></label><label>Reason (required)<textarea required maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></label><FormActions busy={mutation.busy} disabled={cents===null||cents===0||!reason.trim()} label="Record adjustment" cancel={()=>setAdjust(false)}/></fieldset>{!!mutation.error&&<ErrorNotice error={mutation.error}/>}</form>}
  </article>;
}
function PaymentCard({cleanerId,payment,done}:{cleanerId:string;payment:PayoutPayment;done:()=>void}){
  const base=usePayoutBase();
  const[voiding,setVoiding]=useState(false),[reason,setReason]=useState(''),mutation=usePayoutMutation();
  return <article className="payout-cleaning" aria-label={`Payment ${payment.paymentDate} ${payment.id}`}><div className="payout-card-heading"><h4>{money(payment.amountCents)} · {payment.method}</h4><span className={`payout-status ${payment.voidedAt?'review':'paid'}`}>{payment.voidedAt?'Voided':'Recorded'}</span></div><p>{formatDate(payment.paymentDate)}</p>{payment.note&&<p className="payout-comments">{payment.note}</p>}<ul className="payout-history-allocations">{payment.allocations.map(item=><li key={item.cleaningId}><span>{item.propertyName} · {formatDate(item.cleaningDate)}</span><strong>{money(item.amountCents)}</strong></li>)}</ul><small className="payout-recorded-by">Recorded by {payment.enteredBy} · {timestamp(payment.createdAt)}</small>
    {payment.voidedAt?<div className="payout-audit"><p>Void reason: {payment.voidReason}</p><small>Voided by {payment.voidedBy} · {timestamp(payment.voidedAt)}</small></div>:!voiding?<button className="bloom-button secondary" onClick={()=>setVoiding(true)}>Correct / void record</button>:<form className="payout-form" onSubmit={event=>{event.preventDefault();if(reason.trim())void mutation.run(`${base(cleanerId)}/payments/${encodeURIComponent(payment.id)}/void`,{reason:reason.trim()},done);}}><fieldset disabled={mutation.busy}><legend>Void this payment record</legend><p>This keeps the original record and restores the unpaid balances. It does not reverse a real transfer. After voiding, record the corrected payment if needed.</p><label>Reason (required)<textarea required maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></label><FormActions busy={mutation.busy} disabled={!reason.trim()} label="Void payment record" cancel={()=>setVoiding(false)}/></fieldset>{!!mutation.error&&<ErrorNotice error={mutation.error}/>}</form>}
  </article>;
}
