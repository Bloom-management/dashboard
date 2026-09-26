begin;
-- Shared projection keeps cleaner and admin balances, allocations and corrections identical.
create function private.payout_detail(p_cleaner uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;begin
 select jsonb_build_object('id',u.id,'name',coalesce(nullif(u.display_name,''),'Unnamed cleaner'),'preferredMethod',pref.method,'totalDueCents',coalesce((select sum(remaining_cents) from private.payout_balances where cleaner_id=u.id),0),'reviewCount',(select count(*) from private.payout_balances where cleaner_id=u.id and completed_pay_cents is null)) into r from public.users u left join private.payout_preferences pref on pref.cleaner_id=u.id where u.id=p_cleaner;
 return r||jsonb_build_object('cleanings',coalesce((select jsonb_agg(jsonb_build_object(
 'id',b.id,'jobId',b.job_id,'propertyName',b.property_name,'cleaningDate',b.checkout_date,'participation',b.participation,
 'originalEarningsCents',b.completed_pay_cents,'adjustmentCents',b.adjustment_cents,'paidCents',b.paid_cents,'remainingCents',b.remaining_cents,
 'status',case when b.completed_pay_cents is null then 'review' when b.remaining_cents=0 then 'paid' when b.paid_cents>0 then 'partial' else 'unpaid' end,
 'reviewReason',case when b.completed_pay_cents is null then 'Completed cleaning has no saved participant earnings. Review required; no amount has been inferred.' end,
 'comments',b.comments,'adjustments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'amountCents',a.amount_cents,'reason',a.reason,'enteredBy',u.display_name,'createdAt',a.created_at) order by a.created_at,a.id) from private.payout_adjustments a join public.users u on u.id=a.entered_by where a.assignment_id=b.id),'[]'::jsonb)
 ) order by b.checkout_date desc,b.id) from private.payout_balances b where b.cleaner_id=p_cleaner),'[]'::jsonb),
 'payments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'amountCents',p.amount_cents,'method',p.method,'paymentDate',p.payment_date,'note',p.note,'enteredBy',u.display_name,'createdAt',p.created_at,'voidedAt',v.created_at,'voidedBy',vu.display_name,'voidReason',v.reason,
 'allocations',(select jsonb_agg(jsonb_build_object('cleaningId',a.assignment_id,'amountCents',a.amount_cents,'propertyName',b.property_name,'cleaningDate',b.checkout_date) order by b.checkout_date,b.id) from private.payout_allocations a join private.payout_balances b on b.id=a.assignment_id where a.payment_id=p.id)) order by p.payment_date desc,p.created_at desc,p.id)
 from private.payout_payments p join public.users u on u.id=p.entered_by left join private.payout_voids v on v.payment_id=p.id left join public.users vu on vu.id=v.entered_by where p.cleaner_id=p_cleaner),'[]'::jsonb));
end $$;
create or replace function public.bloom_admin_payouts(p_cleaner uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;begin
 perform private.require_actor('admin');
 if p_cleaner is null then
 return jsonb_build_object('people',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(nullif(u.display_name,''),'Unnamed cleaner'),'preferredMethod',pref.method,'totalDueCents',coalesce(b.cents,0),'reviewCount',coalesce(b.reviews,0)) order by lower(u.display_name),u.id)
 from public.users u left join private.payout_preferences pref on pref.cleaner_id=u.id
 left join lateral(select sum(remaining_cents) cents,count(*) filter(where completed_pay_cents is null) reviews from private.payout_balances where cleaner_id=u.id) b on true
 where u.role='cleaner' or exists(select 1 from private.payout_balances where cleaner_id=u.id)),'[]'::jsonb),
 'totalOutstandingCents',coalesce((select sum(remaining_cents) from private.payout_balances),0),
 'reviewCount',(select count(*) from private.payout_balances where completed_pay_cents is null)+(select count(*) from public.jobs j where status='completed' and not exists(select 1 from public.assignments a where a.job_id=j.id and a.ended_at is null)),
 'unassignedReviewCount',(select count(*) from public.jobs j where status='completed' and not exists(select 1 from public.assignments a where a.job_id=j.id and a.ended_at is null)));
 end if;
 if not exists(select 1 from public.users u where id=p_cleaner and (role='cleaner' or exists(select 1 from private.payout_balances where cleaner_id=u.id))) then raise exception 'NOT_FOUND';end if;
 return private.payout_detail(p_cleaner);
end $$;

-- A self-only read boundary; callers cannot select another payee.
create function public.bloom_cleaner_payouts() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor public.users; local_now timestamp; next_local timestamp;begin
 actor:=private.require_actor();
 if actor.role not in ('cleaner','admin') then raise exception 'FORBIDDEN';end if;
 local_now:=now() at time zone 'America/Detroit';
 next_local:=date_trunc('week',local_now)+interval '8 hours';
 if next_local<=local_now then next_local:=next_local+interval '7 days';end if;
 return private.payout_detail(actor.id)||jsonb_build_object('nextPayoutAt',next_local at time zone 'America/Detroit','payoutTimezone','America/Detroit');
end $$;
revoke all on function private.payout_detail(uuid) from public,anon,authenticated,service_role;
revoke all on function public.bloom_cleaner_payouts() from public,anon;
grant execute on function public.bloom_cleaner_payouts() to authenticated;
commit;
