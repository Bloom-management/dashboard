'use client';
import { useCallback, useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import type { CleanerPayouts as PayoutData } from '../../contracts/payouts';
import { request } from './api';
import { formatDate, money } from './dates';
import { Empty, ErrorNotice, Loading, useResource } from './primitives';
import { SelectorPill } from './selector-pill';
import './cleaner-payouts.css';

export function CleanerPayouts() {
  const load = useCallback((signal:AbortSignal) => request<PayoutData>('/cleaner/payouts', {signal}), []);
  const resource = useResource(load, true);
  const {reload} = resource;
  const [history,setHistory] = useState<'earnings'|'payments'>('earnings');
  useEffect(() => {
    const refresh = () => { if(document.visibilityState === 'visible') reload(); };
    const timer = window.setInterval(refresh,30000);
    window.addEventListener('focus',refresh);
    window.addEventListener('bloom:payouts-changed',refresh);
    return () => {clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('bloom:payouts-changed',refresh);};
  },[reload]);
  const data=resource.data;
  if(!data) return resource.error ? <ErrorNotice error={resource.error} retry={reload}/> : <Loading/>;
  const earned=data.cleanings.reduce((sum,row)=>sum+(row.originalEarningsCents===null?0:row.originalEarningsCents+row.adjustmentCents),0);
  const paid=data.payments.filter(row=>!row.voidedAt).reduce((sum,row)=>sum+row.amountCents,0);
  const now=DateTime.now().setZone(data.payoutTimezone);
  const months=Array.from({length:6},(_,index)=>{
    const month=now.minus({months:5-index});
    return {key:month.toFormat('yyyy-MM'),label:month.toFormat('MMM'),full:month.toFormat('MMMM yyyy'),amount:data.cleanings.filter(row=>row.cleaningDate.startsWith(month.toFormat('yyyy-MM'))).reduce((sum,row)=>sum+(row.originalEarningsCents===null?0:row.originalEarningsCents+row.adjustmentCents),0)};
  });
  const max=Math.max(1,...months.map(month=>month.amount));
  const next=DateTime.fromISO(data.nextPayoutAt).setZone(data.payoutTimezone);
  return <section className="cleaner-payouts" aria-label="My payouts">
    <header className="cp-heading"><div><h1>Payouts</h1><p>Your earnings and payments · Synced with Admin</p></div><button className="bloom-button secondary" onClick={reload} disabled={resource.loading}>{resource.loading?'Refreshing…':'Refresh'}</button></header>
    {!!resource.error&&<ErrorNotice error={resource.error} retry={reload}/>}
    <div className="cp-summary">
      <article className="cp-card"><h2>Total earned</h2><strong>{money(earned)}</strong><p>Completed cleanings, including adjustments</p></article>
      <article className="cp-card"><h2>Paid to date</h2><strong>{money(paid)}</strong><p>Payments recorded by your admin</p></article>
      <article className="cp-card cp-balance"><h2>Awaiting payout</h2><strong>{money(data.totalDueCents)}</strong><p>{data.totalDueCents?'Unpaid balance across all completed cleanings':'You’re all caught up'}</p></article>
    </div>
    {data.reviewCount>0&&<p className="bloom-notice" role="status">{data.reviewCount} completed {data.reviewCount===1?'cleaning needs':'cleanings need'} admin review. Missing earnings are excluded from these totals until resolved.</p>}
    <div className="cp-overview cp-card">
      <div><h2>Earnings history</h2><p>Last 6 months · By cleaning date</p><div className="cp-chart" role="img" aria-label={months.map(month=>`${month.full}: ${money(month.amount)}`).join('; ')}>{months.map((month,index)=><div className="cp-month" key={month.key}><span className="cp-bar-value">{money(month.amount)}</span><div className="cp-bar-track"><div className={`cp-bar cp-bar-${index}`} style={{height:`${Math.max(month.amount?3:0,month.amount/max*100)}%`}}/></div><span>{month.label}</span></div>)}</div></div>
      <aside className="cp-schedule"><h2>Next regular payout</h2><strong>{next.toFormat('MMM d, yyyy')}</strong><p>Monday · 8:00 AM · Detroit time</p><div className="cp-schedule-detail"><span>Current balance expected</span><b>{money(data.totalDueCents)}</b></div><p>Payments may arrive earlier, including on the day of a job. Early and partial payments reduce your balance as soon as Admin records them.</p><p>This is the regular schedule, not confirmation that a transfer has been sent.</p>{data.preferredMethod&&<p>Preferred method: <b>{data.preferredMethod}</b></p>}</aside>
    </div>
    <section className="cp-card cp-history"><div className="cp-heading"><h2>Your activity</h2><SelectorPill aria-label="Payout history">{(['earnings','payments'] as const).map(tab=><button key={tab} className={`vt-btn${history===tab?' active':''}`} aria-pressed={history===tab} onClick={()=>setHistory(tab)}>{tab==='earnings'?'Cleanings':'Payments'}</button>)}</SelectorPill></div>
    {history==='earnings'?data.cleanings.length?<div className="cp-rows">{data.cleanings.map(row=><article className="cp-row" key={row.id}><div className="cp-row-head"><div><h3>{row.propertyName}</h3><p>{formatDate(row.cleaningDate)} · {row.participation==='solo'?'Solo':'Shared'}</p></div><span className={`cp-badge cp-${row.status}`}>{({review:'Needs review',paid:'Paid',partial:'Partially paid',unpaid:'Awaiting payout'})[row.status]}</span></div>{row.originalEarningsCents===null?<p>{row.reviewReason}</p>:<dl><div><dt>Earned</dt><dd>{money(row.originalEarningsCents+row.adjustmentCents)}</dd></div><div><dt>Paid</dt><dd>{money(row.paidCents)}</dd></div><div><dt>Remaining</dt><dd>{money(row.remainingCents??0)}</dd></div></dl>}{row.adjustments.length>0&&<details><summary>Adjustments ({row.adjustments.length})</summary>{row.adjustments.map(item=><p key={item.id}>{money(item.amountCents)} · {item.reason}</p>)}</details>}</article>)}</div>:<Empty title="No earnings yet">Completed cleanings will appear here with your finalized pay.</Empty>:data.payments.length?<div className="cp-rows">{data.payments.map(payment=><article className="cp-row" key={payment.id}><div className="cp-row-head"><h3>{money(payment.amountCents)} · {payment.method}</h3>{payment.voidedAt&&<span className="cp-badge cp-review">Voided</span>}</div><p>{formatDate(payment.paymentDate)}</p>{payment.note&&<p>{payment.note}</p>}{payment.allocations.map(item=><p key={item.cleaningId}>{item.propertyName} · {formatDate(item.cleaningDate)} · {money(item.amountCents)}</p>)}{payment.voidedAt&&<p>Removed from paid totals: {payment.voidReason}</p>}</article>)}</div>:<Empty title="No payments recorded yet">Payments will appear here when your admin records them.</Empty>}
    </section>
  </section>;
}
