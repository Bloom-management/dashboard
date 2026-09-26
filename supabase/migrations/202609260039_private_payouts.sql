begin;
-- Existing records are Bloom obligations; new owner payments carry an explicit payer.
alter table private.payout_payments add column payer_owner_id uuid references public.users;
create index payout_payments_payer on private.payout_payments(payer_owner_id,cleaner_id);
create table private.owner_payout_preferences (
 payer_owner_id uuid not null references public.users, cleaner_id uuid not null references public.users,
 method text check(method in ('Zelle','Cash App','Venmo','PayPal','Cash','Bank transfer','Other')),
 updated_by uuid not null references public.users, updated_at timestamptz not null default now(),
 primary key(payer_owner_id,cleaner_id)
);
alter table private.owner_payout_preferences enable row level security;
revoke all on private.owner_payout_preferences from public,anon,authenticated,service_role;
create or replace view private.payout_balances as
 select a.id,a.job_id,a.cleaner_id,a.completed_pay_cents,
 coalesce(adj.cents,0)::bigint adjustment_cents,coalesce(pay.cents,0)::bigint paid_cents,
 case when a.completed_pay_cents is not null then a.completed_pay_cents::bigint+coalesce(adj.cents,0)-coalesce(pay.cents,0) end remaining_cents,
 j.checkout_date,j.completed_at,p.name property_name,
 case when (select count(*) from public.assignments x where x.job_id=j.id and x.ended_at is null)>1 then 'shared' else 'solo' end participation,
 nullif(trim(j.completion_receipt->>'notes'),'') comments,j.payer_owner_id
 from public.assignments a join public.jobs j on j.id=a.job_id join public.properties p on p.id=j.property_id
 left join lateral(select sum(amount_cents)::bigint cents from private.payout_adjustments where assignment_id=a.id) adj on true
 left join lateral(select sum(pa.amount_cents)::bigint cents from private.payout_allocations pa where pa.assignment_id=a.id and not exists(select 1 from private.payout_voids v where v.payment_id=pa.payment_id)) pay on true
 where j.status='completed' and a.ended_at is null;
create function private.payout_detail(p_cleaner uuid,p_payer uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;begin
 select jsonb_build_object('id',u.id,'name',coalesce(nullif(u.display_name,''),'Unnamed cleaner'),'preferredMethod',case when p_payer is null then pref.method else (select method from private.owner_payout_preferences op where op.payer_owner_id=p_payer and op.cleaner_id=u.id) end,'totalDueCents',coalesce((select sum(remaining_cents) from private.payout_balances where cleaner_id=u.id and payer_owner_id is not distinct from p_payer),0),'reviewCount',(select count(*) from private.payout_balances where cleaner_id=u.id and payer_owner_id is not distinct from p_payer and completed_pay_cents is null)) into r from public.users u left join private.payout_preferences pref on pref.cleaner_id=u.id where u.id=p_cleaner;
 return r||jsonb_build_object('cleanings',coalesce((select jsonb_agg(jsonb_build_object(
 'id',b.id,'jobId',b.job_id,'propertyName',b.property_name,'cleaningDate',b.checkout_date,'participation',b.participation,
 'originalEarningsCents',b.completed_pay_cents,'adjustmentCents',b.adjustment_cents,'paidCents',b.paid_cents,'remainingCents',b.remaining_cents,
 'status',case when b.completed_pay_cents is null then 'review' when b.remaining_cents=0 then 'paid' when b.paid_cents>0 then 'partial' else 'unpaid' end,
 'reviewReason',case when b.completed_pay_cents is null then 'Completed cleaning has no saved participant earnings. Review required; no amount has been inferred.' end,
 'comments',b.comments,'adjustments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'amountCents',a.amount_cents,'reason',a.reason,'enteredBy',u.display_name,'createdAt',a.created_at) order by a.created_at,a.id) from private.payout_adjustments a join public.users u on u.id=a.entered_by where a.assignment_id=b.id),'[]'::jsonb)
 ) order by b.checkout_date desc,b.id) from private.payout_balances b where b.cleaner_id=p_cleaner and b.payer_owner_id is not distinct from p_payer),'[]'::jsonb),
 'payments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'amountCents',p.amount_cents,'method',p.method,'paymentDate',p.payment_date,'note',p.note,'enteredBy',u.display_name,'createdAt',p.created_at,'voidedAt',v.created_at,'voidedBy',vu.display_name,'voidReason',v.reason,
 'allocations',(select jsonb_agg(jsonb_build_object('cleaningId',a.assignment_id,'amountCents',a.amount_cents,'propertyName',b.property_name,'cleaningDate',b.checkout_date) order by b.checkout_date,b.id) from private.payout_allocations a join private.payout_balances b on b.id=a.assignment_id where a.payment_id=p.id)) order by p.payment_date desc,p.created_at desc,p.id)
 from private.payout_payments p join public.users u on u.id=p.entered_by left join private.payout_voids v on v.payment_id=p.id left join public.users vu on vu.id=v.entered_by where p.cleaner_id=p_cleaner and p.payer_owner_id is not distinct from p_payer),'[]'::jsonb));
end $$;
create function private.payout_summary(p_payer uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;begin
 return jsonb_build_object('people',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(nullif(u.display_name,''),'Unnamed cleaner'),'preferredMethod',case when p_payer is null then pref.method else (select method from private.owner_payout_preferences op where op.payer_owner_id=p_payer and op.cleaner_id=u.id) end,'totalDueCents',coalesce(b.cents,0),'reviewCount',coalesce(b.reviews,0)) order by lower(u.display_name),u.id)
 from public.users u left join private.payout_preferences pref on pref.cleaner_id=u.id
 left join lateral(select sum(remaining_cents) cents,count(*) filter(where completed_pay_cents is null) reviews from private.payout_balances where cleaner_id=u.id and payer_owner_id is not distinct from p_payer) b on true
 where (p_payer is null and u.role='cleaner') or exists(select 1 from private.payout_balances where cleaner_id=u.id and payer_owner_id is not distinct from p_payer)),'[]'::jsonb),
 'totalOutstandingCents',coalesce((select sum(remaining_cents) from private.payout_balances where payer_owner_id is not distinct from p_payer),0),
 'reviewCount',(select count(*) from private.payout_balances where payer_owner_id is not distinct from p_payer and completed_pay_cents is null)+(select count(*) from public.jobs j where j.payer_owner_id is not distinct from p_payer and status='completed' and not exists(select 1 from public.assignments a where a.job_id=j.id and a.ended_at is null)),
 'unassignedReviewCount',(select count(*) from public.jobs j where j.payer_owner_id is not distinct from p_payer and status='completed' and not exists(select 1 from public.assignments a where a.job_id=j.id and a.ended_at is null)));
end $$;
create function private.payout_action(p_payer uuid,p_cleaner uuid,p_action text,p_data jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.users;r jsonb;input jsonb:=jsonb_build_object('cleaner',p_cleaner,'action',p_action,'data',p_data);v jsonb;balance private.payout_balances;payment private.payout_payments;new_id uuid;amount integer;total bigint;method text;paid_on date;begin
 actor:=private.require_actor();
 if (p_payer is null and actor.role<>'admin') or (p_payer is not null and (actor.id<>p_payer or actor.role not in ('owner','admin'))) then raise exception 'FORBIDDEN';end if;
 if p_payer is not null and not exists(select 1 from private.payout_balances where cleaner_id=p_cleaner and payer_owner_id=p_payer) then raise exception 'NOT_FOUND';end if;
 perform 1 from public.users where id=p_cleaner for update;
 if not found then raise exception 'NOT_FOUND';end if;
 r:=private.receipt(case when p_payer is null then 'admin_payout' else 'owner_payout' end,p_key,input);if r is not null then return r;end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'VALIDATION_ERROR';end if;
 if p_action='payment' then
 if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('amountCents','method','paymentDate','note','allocations')) then raise exception 'VALIDATION_ERROR';end if;
 if jsonb_typeof(p_data->'amountCents') is distinct from 'number' or (p_data->>'amountCents')!~'^[0-9]+$' then raise exception 'VALIDATION_ERROR';end if;
 amount:=(p_data->>'amountCents')::integer;method:=p_data->>'method';
 if amount not between 1 and 100000000 or method is null or method not in ('Zelle','Cash App','Venmo','PayPal','Cash','Bank transfer','Other') or coalesce(p_data->>'paymentDate','')!~'^\d{4}-\d{2}-\d{2}$' or (p_data?'note' and jsonb_typeof(p_data->'note') not in ('string','null')) or length(coalesce(p_data->>'note',''))>1000 then raise exception 'VALIDATION_ERROR';end if;
 paid_on:=(p_data->>'paymentDate')::date;if paid_on>current_date then raise exception 'VALIDATION_ERROR';end if;
 if jsonb_typeof(p_data->'allocations') is distinct from 'array' or jsonb_array_length(p_data->'allocations') not between 1 and 100 then raise exception 'VALIDATION_ERROR';end if;
 if exists(select 1 from jsonb_array_elements(p_data->'allocations') x group by x->>'cleaningId' having count(*)>1) then raise exception 'VALIDATION_ERROR';end if;
 total:=0;
 for v in select value from jsonb_array_elements(p_data->'allocations') loop
 if jsonb_typeof(v)<>'object' or exists(select 1 from jsonb_object_keys(v) k where k not in ('cleaningId','amountCents')) or jsonb_typeof(v->'amountCents') is distinct from 'number' or (v->>'amountCents')!~'^[0-9]+$' or (v->>'amountCents')::bigint not between 1 and 100000000 then raise exception 'VALIDATION_ERROR';end if;
 select * into balance from private.payout_balances where id=(v->>'cleaningId')::uuid and cleaner_id=p_cleaner and payer_owner_id is not distinct from p_payer;
 if not found then raise exception 'NOT_FOUND';end if;
 if balance.completed_pay_cents is null then raise exception 'REVIEW_REQUIRED';end if;
 if (v->>'amountCents')::bigint>balance.remaining_cents then raise exception 'CONFLICT';end if;
 total:=total+(v->>'amountCents')::bigint;
 end loop;
 if total<>amount then raise exception 'VALIDATION_ERROR';end if;
 insert into private.payout_payments(payer_owner_id,cleaner_id,amount_cents,method,payment_date,note,entered_by) values(p_payer,p_cleaner,amount,method,paid_on,nullif(trim(p_data->>'note'),''),actor.id) returning id into new_id;
 insert into private.payout_allocations(payment_id,assignment_id,amount_cents) select new_id,(x->>'cleaningId')::uuid,(x->>'amountCents')::integer from jsonb_array_elements(p_data->'allocations') x;
 elsif p_action='adjustment' then
 if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('cleaningId','amountCents','reason')) or jsonb_typeof(p_data->'amountCents') is distinct from 'number' or (p_data->>'amountCents')!~'^-?[0-9]+$' or jsonb_typeof(p_data->'reason') is distinct from 'string' or coalesce(length(trim(p_data->>'reason')),0) not between 1 and 1000 then raise exception 'VALIDATION_ERROR';end if;
 amount:=(p_data->>'amountCents')::integer;if amount=0 or abs(amount::bigint)>100000000 then raise exception 'VALIDATION_ERROR';end if;
 select * into balance from private.payout_balances where id=(p_data->>'cleaningId')::uuid and cleaner_id=p_cleaner and payer_owner_id is not distinct from p_payer;
 if not found then raise exception 'NOT_FOUND';end if;
 if balance.completed_pay_cents is null then raise exception 'REVIEW_REQUIRED';end if;
 if balance.remaining_cents+amount<0 then raise exception 'CONFLICT';end if;
 insert into private.payout_adjustments(assignment_id,amount_cents,reason,entered_by) values(balance.id,amount,trim(p_data->>'reason'),actor.id) returning id into new_id;
 elsif p_action='void' then
 if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('paymentId','reason')) or jsonb_typeof(p_data->'reason') is distinct from 'string' or coalesce(length(trim(p_data->>'reason')),0) not between 1 and 1000 then raise exception 'VALIDATION_ERROR';end if;
 select * into payment from private.payout_payments where id=(p_data->>'paymentId')::uuid and cleaner_id=p_cleaner and payer_owner_id is not distinct from p_payer;
 if not found then raise exception 'NOT_FOUND';end if;
 if exists(select 1 from private.payout_voids where payment_id=payment.id) then raise exception 'CONFLICT';end if;
 insert into private.payout_voids(payment_id,reason,entered_by) values(payment.id,trim(p_data->>'reason'),actor.id);new_id:=payment.id;
 elsif p_action='preference' then
 if exists(select 1 from jsonb_object_keys(p_data) k where k<>'method') or not(p_data?'method') then raise exception 'VALIDATION_ERROR';end if;
 method:=p_data->>'method';if method is not null and method not in ('Zelle','Cash App','Venmo','PayPal','Cash','Bank transfer','Other') then raise exception 'VALIDATION_ERROR';end if;
 if p_payer is null then
 insert into private.payout_preferences(cleaner_id,method,updated_by) values(p_cleaner,method,actor.id) on conflict(cleaner_id) do update set method=excluded.method,updated_by=excluded.updated_by,updated_at=clock_timestamp();else
 insert into private.owner_payout_preferences(payer_owner_id,cleaner_id,method,updated_by) values(p_payer,p_cleaner,method,actor.id) on conflict(payer_owner_id,cleaner_id) do update set method=excluded.method,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 end if;new_id:=p_cleaner;
 else raise exception 'VALIDATION_ERROR';end if;
 return private.save_receipt(case when p_payer is null then 'admin_payout' else 'owner_payout' end,p_key,input,jsonb_build_object('id',new_id));
exception when numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR';
end $$;

create or replace function private.payout_detail(p_cleaner uuid) returns jsonb language sql stable security definer set search_path='' as $$ select private.payout_detail(p_cleaner,null) $$;
create or replace function public.bloom_admin_payouts(p_cleaner uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 perform private.require_actor('admin');
 if p_cleaner is null then return private.payout_summary(null);end if;
 if not exists(select 1 from public.users where id=p_cleaner) then raise exception 'NOT_FOUND';end if;
 return private.payout_detail(p_cleaner,null);
end $$;
create function public.bloom_owner_payouts(p_cleaner uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$ declare actor public.users;begin
 actor:=private.require_actor();if actor.role not in ('owner','admin') then raise exception 'FORBIDDEN';end if;
 if p_cleaner is null then return private.payout_summary(actor.id);end if;
 if not exists(select 1 from private.payout_balances where cleaner_id=p_cleaner and payer_owner_id=actor.id) then raise exception 'NOT_FOUND';end if;
 return private.payout_detail(p_cleaner,actor.id);
end $$;
create or replace function public.bloom_admin_payout_action(p_cleaner uuid,p_action text,p_data jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$ begin
 perform private.require_actor('admin');return private.payout_action(null,p_cleaner,p_action,p_data,p_key);
end $$;
create function public.bloom_owner_payout_action(p_cleaner uuid,p_action text,p_data jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$ declare actor public.users;begin
 actor:=private.require_actor();if actor.role not in ('owner','admin') then raise exception 'FORBIDDEN';end if;
 return private.payout_action(actor.id,p_cleaner,p_action,p_data,p_key);
end $$;
create or replace function public.bloom_cleaner_payouts() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor public.users;local_now timestamp;next_local timestamp;groups jsonb;begin
 actor:=private.require_actor();if actor.role not in ('cleaner','admin') then raise exception 'FORBIDDEN';end if;
 local_now:=now() at time zone 'America/Detroit';next_local:=date_trunc('week',local_now)+interval '8 hours';
 if next_local<=local_now then next_local:=next_local+interval '7 days';end if;
 select coalesce(jsonb_agg(jsonb_build_object('payerId',q.payer_owner_id,'payerName',case when q.payer_owner_id is null then 'Bloom Cleaning' else coalesce(nullif(u.display_name,''),'Property owner') end,'payerType',case when q.payer_owner_id is null then 'bloom' else 'owner' end,'detail',private.payout_detail(actor.id,q.payer_owner_id)) order by q.payer_owner_id nulls first),'[]'::jsonb) into groups
 from (select null::uuid payer_owner_id union select payer_owner_id from private.payout_balances where cleaner_id=actor.id) q left join public.users u on u.id=q.payer_owner_id;
 -- Legacy top-level projection stays Bloom-only, never implying owners' debts are Bloom's.
 return private.payout_detail(actor.id,null)||jsonb_build_object('payers',groups,'nextPayoutAt',next_local at time zone 'America/Detroit','payoutTimezone','America/Detroit');
end $$;
revoke all on function private.payout_detail(uuid,uuid),private.payout_summary(uuid),private.payout_action(uuid,uuid,text,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.bloom_owner_payouts(uuid),public.bloom_owner_payout_action(uuid,text,jsonb,text) from public,anon,service_role;
grant execute on function public.bloom_owner_payouts(uuid),public.bloom_owner_payout_action(uuid,text,jsonb,text) to authenticated;
commit;
