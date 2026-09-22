begin;
-- Existing assignments.completed_pay_cents is the finalized participant earning.
-- Never reconstruct historical pay from today's property rate or divide solo rates.
create table private.payout_preferences (
 cleaner_id uuid primary key references public.users,
 method text check(method in ('Zelle','Cash App','Venmo','PayPal','Cash','Bank transfer','Other')),
 updated_by uuid not null references public.users, updated_at timestamptz not null default now()
);
create table private.payout_adjustments (
 id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.assignments,
 amount_cents integer not null check(amount_cents<>0 and abs(amount_cents::bigint)<=100000000),
 reason text not null check(length(trim(reason)) between 1 and 1000),
 entered_by uuid not null references public.users, created_at timestamptz not null default now()
);
create table private.payout_payments (
 id uuid primary key default gen_random_uuid(), cleaner_id uuid not null references public.users,
 amount_cents integer not null check(amount_cents between 1 and 100000000),
 method text not null check(method in ('Zelle','Cash App','Venmo','PayPal','Cash','Bank transfer','Other')),
 payment_date date not null, note text check(length(note)<=1000),
 entered_by uuid not null references public.users, created_at timestamptz not null default now()
);
create table private.payout_allocations (
 payment_id uuid not null references private.payout_payments, assignment_id uuid not null references public.assignments,
 amount_cents integer not null check(amount_cents between 1 and 100000000), primary key(payment_id,assignment_id)
);
create table private.payout_voids (
 payment_id uuid primary key references private.payout_payments,
 reason text not null check(length(trim(reason)) between 1 and 1000),
 entered_by uuid not null references public.users, created_at timestamptz not null default now()
);
create index payout_adjustments_assignment on private.payout_adjustments(assignment_id);
create index payout_allocations_assignment on private.payout_allocations(assignment_id);
create index payout_payments_cleaner on private.payout_payments(cleaner_id);
-- Private schema plus RLS and no table privileges: only checked RPCs can expose data.
do $$ declare t text;begin
 foreach t in array array['payout_preferences','payout_adjustments','payout_payments','payout_allocations','payout_voids'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 if t<>'payout_preferences' then execute format('create trigger immutable before update or delete on private.%I for each row execute function private.immutable()',t);end if;
 end loop;
end $$;
create function private.protect_finalized_earning() returns trigger language plpgsql set search_path='' as $$ begin
 if exists(select 1 from public.jobs where id=old.job_id and status='completed') then
 if tg_op='DELETE' or row(new.job_id,new.cleaner_id,new.slot,new.ended_at,new.end_reason,new.completed_pay_cents) is distinct from row(old.job_id,old.cleaner_id,old.slot,old.ended_at,old.end_reason,old.completed_pay_cents) then raise exception 'INVALID_STATE';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger finalized_earning_immutable before update or delete on public.assignments for each row execute function private.protect_finalized_earning();
create view private.payout_balances as
 select a.id,a.job_id,a.cleaner_id,a.completed_pay_cents,
 coalesce(adj.cents,0)::bigint adjustment_cents,coalesce(pay.cents,0)::bigint paid_cents,
 case when a.completed_pay_cents is not null then a.completed_pay_cents::bigint+coalesce(adj.cents,0)-coalesce(pay.cents,0) end remaining_cents,
 j.checkout_date,j.completed_at,p.name property_name,
 case when (select count(*) from public.assignments x where x.job_id=j.id and x.ended_at is null)>1 then 'shared' else 'solo' end participation,
 nullif(trim(j.completion_receipt->>'notes'),'') comments
 from public.assignments a join public.jobs j on j.id=a.job_id join public.properties p on p.id=j.property_id
 left join lateral(select sum(amount_cents)::bigint cents from private.payout_adjustments where assignment_id=a.id) adj on true
 left join lateral(select sum(pa.amount_cents)::bigint cents from private.payout_allocations pa where pa.assignment_id=a.id and not exists(select 1 from private.payout_voids v where v.payment_id=pa.payment_id)) pay on true
 where j.status='completed' and a.ended_at is null;
revoke all on private.payout_balances from public,anon,authenticated,service_role;
create function public.bloom_admin_payouts(p_cleaner uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
-- Every accounting mutation locks the payee first. All participants in a payment,
-- adjustments and voids consequently serialize, including separate admin sessions.
create function public.bloom_admin_payout_action(p_cleaner uuid,p_action text,p_data jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.users;r jsonb;input jsonb:=jsonb_build_object('cleaner',p_cleaner,'action',p_action,'data',p_data);v jsonb;balance private.payout_balances;payment private.payout_payments;new_id uuid;amount integer;total bigint;method text;paid_on date;begin
 actor:=private.require_actor('admin');
 perform 1 from public.users where id=p_cleaner for update;
 if not found then raise exception 'NOT_FOUND';end if;
 r:=private.receipt('admin_payout',p_key,input);if r is not null then return r;end if;
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
 select * into balance from private.payout_balances where id=(v->>'cleaningId')::uuid and cleaner_id=p_cleaner;
 if not found then raise exception 'NOT_FOUND';end if;
 if balance.completed_pay_cents is null then raise exception 'REVIEW_REQUIRED';end if;
 if (v->>'amountCents')::bigint>balance.remaining_cents then raise exception 'CONFLICT';end if;
 total:=total+(v->>'amountCents')::bigint;
 end loop;
 if total<>amount then raise exception 'VALIDATION_ERROR';end if;
 insert into private.payout_payments(cleaner_id,amount_cents,method,payment_date,note,entered_by) values(p_cleaner,amount,method,paid_on,nullif(trim(p_data->>'note'),''),actor.id) returning id into new_id;
 insert into private.payout_allocations(payment_id,assignment_id,amount_cents) select new_id,(x->>'cleaningId')::uuid,(x->>'amountCents')::integer from jsonb_array_elements(p_data->'allocations') x;
 elsif p_action='adjustment' then
 if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('cleaningId','amountCents','reason')) or jsonb_typeof(p_data->'amountCents') is distinct from 'number' or (p_data->>'amountCents')!~'^-?[0-9]+$' or jsonb_typeof(p_data->'reason') is distinct from 'string' or coalesce(length(trim(p_data->>'reason')),0) not between 1 and 1000 then raise exception 'VALIDATION_ERROR';end if;
 amount:=(p_data->>'amountCents')::integer;if amount=0 or abs(amount::bigint)>100000000 then raise exception 'VALIDATION_ERROR';end if;
 select * into balance from private.payout_balances where id=(p_data->>'cleaningId')::uuid and cleaner_id=p_cleaner;
 if not found then raise exception 'NOT_FOUND';end if;
 if balance.completed_pay_cents is null then raise exception 'REVIEW_REQUIRED';end if;
 if balance.remaining_cents+amount<0 then raise exception 'CONFLICT';end if;
 insert into private.payout_adjustments(assignment_id,amount_cents,reason,entered_by) values(balance.id,amount,trim(p_data->>'reason'),actor.id) returning id into new_id;
 elsif p_action='void' then
 if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('paymentId','reason')) or jsonb_typeof(p_data->'reason') is distinct from 'string' or coalesce(length(trim(p_data->>'reason')),0) not between 1 and 1000 then raise exception 'VALIDATION_ERROR';end if;
 select * into payment from private.payout_payments where id=(p_data->>'paymentId')::uuid and cleaner_id=p_cleaner;
 if not found then raise exception 'NOT_FOUND';end if;
 if exists(select 1 from private.payout_voids where payment_id=payment.id) then raise exception 'CONFLICT';end if;
 insert into private.payout_voids(payment_id,reason,entered_by) values(payment.id,trim(p_data->>'reason'),actor.id);new_id:=payment.id;
 elsif p_action='preference' then
 if exists(select 1 from jsonb_object_keys(p_data) k where k<>'method') or not(p_data?'method') then raise exception 'VALIDATION_ERROR';end if;
 method:=p_data->>'method';if method is not null and method not in ('Zelle','Cash App','Venmo','PayPal','Cash','Bank transfer','Other') then raise exception 'VALIDATION_ERROR';end if;
 insert into private.payout_preferences(cleaner_id,method,updated_by) values(p_cleaner,method,actor.id) on conflict(cleaner_id) do update set method=excluded.method,updated_by=excluded.updated_by,updated_at=clock_timestamp();new_id:=p_cleaner;
 else raise exception 'VALIDATION_ERROR';end if;
 return private.save_receipt('admin_payout',p_key,input,jsonb_build_object('id',new_id));
exception when numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR';
end $$;
revoke all on function private.protect_finalized_earning() from public,anon,authenticated;
revoke all on function public.bloom_admin_payouts(uuid),public.bloom_admin_payout_action(uuid,text,jsonb,text) from public,anon;
grant execute on function public.bloom_admin_payouts(uuid),public.bloom_admin_payout_action(uuid,text,jsonb,text) to authenticated;
commit;
