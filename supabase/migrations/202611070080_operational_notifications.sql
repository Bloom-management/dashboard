begin;
alter table public.jobs add column coverage_revision integer not null default 0;
-- Event provenance is shared by inbox and push; account/category preferences affect push only.
alter table private.push_preferences add column categories jsonb not null default '{"unclaimed":true,"assignments":true,"teammates":true,"changes":true,"payments":true,"coverage":true,"calendar":true,"requests":true,"payouts":true,"invitations":true}';
create table private.notification_events(
 id uuid primary key default gen_random_uuid(), event_key text not null,user_id uuid not null references public.users,
 category text not null,kind text not null,job_id uuid references public.jobs,property_id uuid references public.properties,
 payload jsonb not null default '{}',created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '7 days',
 unique(event_key,user_id)
);
create index notification_events_recipient on private.notification_events(user_id,created_at desc);
create table private.opportunity_notifications(job_id uuid references public.jobs,user_id uuid references public.users,local_day date,primary key(job_id,user_id,local_day));
revoke all on private.notification_events,private.opportunity_notifications from public,anon,authenticated,service_role;
alter table private.push_messages drop constraint push_messages_kind_check;
alter table private.push_messages add constraint push_messages_kind_check check(kind in ('new','evening','morning','test','completion','handoff','start','low_supplies','maintenance','event'));
alter table private.push_messages add column notification_event_id uuid references private.notification_events;

create function private.notification_preference(p_user uuid,p_category text) returns boolean language sql stable set search_path='' as $$
 select coalesce((case p_category when 'newJobs' then to_jsonb(new_jobs) when 'reminders' then to_jsonb(reminders)
 when 'completions' then to_jsonb(completions) when 'starts' then to_jsonb(starts) when 'lowSupplies' then to_jsonb(low_supplies)
 when 'maintenance' then to_jsonb(maintenance) else categories->p_category end)::boolean,false) from private.push_preferences where user_id=p_user;
$$;
create function private.notification_emit(p_key text,p_user uuid,p_category text,p_kind text,p_job uuid default null,p_property uuid default null,p_payload jsonb default '{}',p_expires timestamptz default now()+interval '7 days') returns void
language plpgsql security definer set search_path='' as $$
declare e uuid;begin
 if (select role='admin' from public.users where id=p_user) then p_category:=case p_category when 'teammates' then 'assignments' when 'changes' then 'calendar' else p_category end;end if;
 insert into private.notification_events(event_key,user_id,category,kind,job_id,property_id,payload,expires_at)
 values(p_key,p_user,p_category,p_kind,p_job,p_property,p_payload,p_expires) on conflict do nothing returning id into e;
 if e is not null and (select activated_at is not null from private.push_control) and exists(select 1 from private.push_preferences where user_id=p_user and push_enabled) and private.notification_preference(p_user,p_category) then
  insert into private.push_messages(logical_key,user_id,kind,job_ids,notification_event_id,expires_at)
  values('event:'||e,p_user,'event',case when p_job is not null then array[p_job] end,e,least(p_expires,now()+interval '24 hours')) on conflict do nothing;
 end if;
end $$;
-- Preserve all existing category choices; new grouped categories default on.
alter function public.bloom_push_device(text,uuid,text,text,jsonb) rename to bloom_push_device_before_events;
revoke all on function public.bloom_push_device_before_events(text,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
create function public.bloom_push_device(p_device text,p_user uuid,p_session text,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;patch jsonb;begin
 r:=public.bloom_push_device_before_events(p_device,p_user,p_session,p_action,p_input);
 if p_action='preferences' then
  select coalesce(jsonb_object_agg(key,value),'{}') into patch from jsonb_each(p_input) where key=any(array['unclaimed','assignments','teammates','changes','payments','coverage','calendar','requests','payouts','invitations']);
  if exists(select 1 from jsonb_each(patch) where jsonb_typeof(value)<>'boolean') then raise exception 'VALIDATION_ERROR';end if;
  update private.push_preferences set categories=categories||patch where user_id=p_user;
 end if;
 return r||coalesce((select categories from private.push_preferences where user_id=p_user),'{}');
end $$;
revoke all on function public.bloom_push_device(text,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.bloom_push_device(text,uuid,text,text,jsonb) to service_role;

create function private.expected_compensation(p_job uuid,p_cleaner uuid) returns integer language sql stable set search_path='' as $$
 select case when j.cleaning_management='private' and j.compensation_mode='individual' then a.agreed_pay_cents
 when j.cleaning_management='private' then j.private_total_cents_snapshot/c.n+case when a.cleaner_id in(
  select x.cleaner_id from public.assignments x where x.job_id=j.id and x.ended_at is null order by x.cleaner_id,x.id limit (j.private_total_cents_snapshot%c.n)) then 1 else 0 end
 else j.solo_rate_cents_snapshot/c.n end
 from public.jobs j join public.assignments a on a.job_id=j.id and a.cleaner_id=p_cleaner and a.ended_at is null
 cross join lateral(select count(*)::integer n from public.assignments where job_id=j.id and ended_at is null)c
 where j.id=p_job and c.n>0;
$$;
create function private.notification_money(p_cents bigint) returns text language sql immutable set search_path='' as $$
 select '$'||case when p_cents%100=0 then (p_cents/100)::text else to_char(p_cents/100.0,'FM999999999990.00') end;
$$;
create function private.notify_managers(p_key text,p_job uuid,p_category text,p_kind text,p_payload jsonb default '{}',p_skip uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare j public.jobs;u record;begin
 select * into j from public.jobs where id=p_job;
 for u in select distinct actor.id from public.users actor where actor.id is distinct from p_skip and private.people_access(j.property_id,actor.id)
 and (actor.role='owner' or exists(select 1 from public.property_owners where property_id=j.property_id and owner_id=actor.id) or (actor.role='admin' and j.cleaning_management='bloom')) loop
  perform private.notification_emit(p_key,u.id,p_category,p_kind,j.id,j.property_id,p_payload||jsonb_build_object('audience','manager'));
 end loop;
end $$;
create function private.notify_coverage(p_job uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare j public.jobs;begin
 select * into j from public.jobs where id=p_job;
 if j.status<>'open' or j.started_at is not null or j.setup_required or exists(select 1 from public.assignments where job_id=j.id and ended_at is null) then return;end if;
 perform private.notify_managers('coverage:'||j.id||':'||j.checkout_date||':'||(now() at time zone j.timezone_snapshot)::date||':'||j.coverage_revision,j.id,'coverage','coverage',jsonb_build_object('date',j.checkout_date,'coverageRevision',j.coverage_revision));
end $$;
create function private.notify_assignment_change() returns trigger language plpgsql security definer set search_path='' as $$
declare j public.jobs;actor uuid;u record;k text;event_key text;data jsonb;begin
 select * into j from public.jobs where id=new.job_id;actor:=(private.actor()).id;
 if TG_OP='INSERT' then
  k:='joined';event_key:='assignment:'||new.id;data:=jsonb_build_object('cleanerId',new.cleaner_id,'assignmentId',new.id,'date',j.checkout_date);
  if new.cleaner_id is distinct from actor then perform private.notification_emit(event_key,new.cleaner_id,'assignments','assigned',j.id,j.property_id,data||'{"audience":"participant"}');end if;
 elsif old.ended_at is null and new.ended_at is not null and new.end_reason in ('withdrawn','reassigned') then
  k:='withdrawn';event_key:='withdrawal:'||new.id;data:=jsonb_build_object('cleanerId',new.cleaner_id,'assignmentId',new.id,'comment',new.withdrawal_comment,'date',j.checkout_date);
 elsif new.ended_at is null and old.agreed_pay_cents is distinct from new.agreed_pay_cents then
  perform private.notification_emit('compensation:'||new.id||':'||pg_current_xact_id(),new.cleaner_id,'changes','compensation',j.id,j.property_id,jsonb_build_object('audience','participant','assignmentId',new.id));return new;
 else return new;end if;
 for u in select cleaner_id from public.assignments where job_id=j.id and ended_at is null and cleaner_id<>new.cleaner_id and cleaner_id is distinct from actor loop
  perform private.notification_emit(event_key,u.cleaner_id,'teammates',k,j.id,j.property_id,data||'{"audience":"participant"}');
 end loop;
 -- One logical event/account, even when an admin also participates.
 perform private.notify_managers(event_key,j.id,'assignments',case when k='joined' then case when actor=new.cleaner_id then 'claimed' else 'staffed' end else 'withdrawn' end,data,actor);
 if k='withdrawn' and not exists(select 1 from public.assignments where job_id=j.id and ended_at is null) and j.checkout_date=(now() at time zone j.timezone_snapshot)::date then
  update public.jobs set coverage_revision=coverage_revision+1 where id=j.id;
  perform private.notify_coverage(j.id,'same-day');
 end if;
 return new;
end $$;
create trigger notify_assignment_change after insert or update on public.assignments for each row execute function private.notify_assignment_change();

create function private.notify_job_change() returns trigger language plpgsql security definer set search_path='' as $$
declare a record;actor uuid;key text;kind text;data jsonb;begin
 actor:=(private.actor()).id;
 if TG_OP='INSERT' then
  if new.checkout_date=(now() at time zone new.timezone_snapshot)::date then perform private.notify_coverage(new.id,'same-day');end if;return new;
 end if;
 if new.status='open' and new.checkout_date=(now() at time zone new.timezone_snapshot)::date
 and (old.review_required or old.setup_required or old.status<>'open' or old.cleaning_management is distinct from new.cleaning_management)
 and not new.review_required and not new.setup_required and not exists(select 1 from public.assignments where job_id=new.id and ended_at is null) then
  perform private.notify_coverage(new.id,'same-day');
  if new.cleaning_management='bloom' then perform private.notify_opportunities(array[new.id],'available','same-day:'||new.id||':'||new.checkout_date,now());end if;
 end if;
 if new.guest_extension_revision>old.guest_extension_revision then kind:='extended';
 elsif new.status='cancelled' and old.status<>'cancelled' then kind:='cancelled';
 elsif (new.solo_rate_cents_snapshot,new.private_total_cents_snapshot) is distinct from (old.solo_rate_cents_snapshot,old.private_total_cents_snapshot) then kind:='rate_changed';
 elsif (new.checkout_date,new.start_at,new.end_at,new.solo_rate_cents_snapshot,new.private_total_cents_snapshot) is distinct from (old.checkout_date,old.start_at,old.end_at,old.solo_rate_cents_snapshot,old.private_total_cents_snapshot) then kind:='changed';
 else return new;end if;
 key:='job-change:'||new.id||':'||pg_current_xact_id();data:=jsonb_build_object('oldDate',old.checkout_date,'newDate',new.checkout_date,'revision',new.guest_extension_revision);
 for a in select distinct cleaner_id from public.assignments where job_id=new.id and (ended_at is null or (kind='cancelled' and end_reason='cancelled' and ended_at>=transaction_timestamp())) and cleaner_id is distinct from actor loop
  perform private.notification_emit(key,a.cleaner_id,'changes',kind,new.id,new.property_id,data||'{"audience":"participant"}');
 end loop;
 perform private.notify_managers(key,new.id,'calendar',kind,data,actor);
 return new;
end $$;
create trigger zzy_notify_job_change after insert or update on public.jobs for each row execute function private.notify_job_change();

create function private.notification_content(p_event uuid,p_now timestamptz,p_push boolean default true) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e private.notification_events;j public.jobs;p public.properties;u public.users;n integer;label text;person text;body text;href text;amount bigint;ids uuid[];first_day date;begin
 select * into e from private.notification_events where id=p_event;
 select * into u from public.users where id=e.user_id;
 if e.id is null or u.id is null or e.expires_at<=p_now then return null;end if;
 if p_push and not coalesce(private.notification_preference(u.id,e.category),false) then return null;end if;
 if e.kind in ('available','unclaimed') then
  if u.role<>'cleaner' or not u.bloom_network_enabled or not u.bloom_pool_approved then return null;end if;
  select array_agg(x.id order by x.checkout_date,x.id),count(*),min(x.checkout_date) into ids,n,first_day from public.jobs x join public.properties prop on prop.id=x.property_id
  where x.id in(select value::uuid from jsonb_array_elements_text(e.payload->'jobs')) and prop.city_id=u.approved_city_id
   and x.started_at is null and private.push_claimable(x.id,p_now)
   and (e.kind='available' or not exists(select 1 from public.assignments a where a.job_id=x.id and a.ended_at is null))
   and not exists(select 1 from public.assignments a where a.job_id=x.id and a.cleaner_id=u.id and a.ended_at is null);
  if n=0 then return null;end if;
  if n=1 then
   select prop.name into label from public.jobs x join public.properties prop on prop.id=x.property_id where x.id=ids[1];
   body:=label||case when e.kind='unclaimed' then ' is still unclaimed for ' else ' is available for ' end||case when first_day=(p_now at time zone (select timezone_snapshot from public.jobs where id=ids[1]))::date+1 then 'tomorrow' else to_char(first_day,'Mon FMDD') end||'.';
  else body:=n||case when e.kind='unclaimed' then ' cleanings are still unclaimed.' else ' new cleanings are available.' end;end if;
  return jsonb_build_object('body',body,'url','/cleaner?view=calendar&city='||u.approved_city_id||'&date='||first_day,'count',n);
 end if;
 if e.kind='payment' then
  select pp.amount_cents,case when pp.payer_owner_id is null then 'Bloom' else coalesce(nullif(payer.display_name,''),'Your owner') end into amount,person
  from private.payout_payments pp left join public.users payer on payer.id=pp.payer_owner_id
  where pp.id=(e.payload->>'paymentId')::uuid and pp.cleaner_id=u.id and not exists(select 1 from private.payout_voids v where v.payment_id=pp.id);
  if amount is null then return null;end if;
  return jsonb_build_object('body',person||' sent you '||private.notification_money(amount)||'.','url','/cleaner?view=payouts&history=payments');
 end if;
 if e.kind='payouts' then
  if u.role not in ('admin','owner') then return null;end if;
  select sum(remaining_cents) into amount from private.payout_balances where remaining_cents>0 and
   ((u.role='admin' and payer_owner_id is null) or (u.role='owner' and payer_owner_id=u.id));
  if coalesce(amount,0)<=0 then return null;end if;
  return jsonb_build_object('body','Payments due: '||private.notification_money(amount)||'.','url','/'||u.role||'?view=payouts');
 end if;
 if e.kind='request' then
  if u.role<>'admin' then return null;end if;
  if e.payload->>'requestType'='city' then
   select cleaner.display_name into person from public.city_change_requests req join public.users cleaner on cleaner.id=req.cleaner_id where req.id=(e.payload->>'requestId')::uuid and req.status='pending';
  else
   select cleaner.display_name into person from private.bloom_pool_requests req join public.users cleaner on cleaner.id=req.cleaner_id where req.id=(e.payload->>'requestId')::uuid and req.status='pending';
  end if;
  if person is null then return null;end if;
  return jsonb_build_object('body',person||' has a pending cleaner request.','url','/admin?view=people');
 end if;
 if e.property_id is not null then select * into p from public.properties where id=e.property_id and active and deleted_at is null;if p.id is null then return null;end if;end if;
 if e.job_id is not null then select * into j from public.jobs where id=e.job_id;if j.id is null then return null;end if;end if;
 if e.payload->>'audience'='manager' then
  if not private.people_access(p.id,u.id) or (coalesce(j.cleaning_management,p.cleaning_management)='private' and u.role='admin' and not exists(select 1 from public.property_owners where property_id=p.id and owner_id=u.id)) then return null;end if;
 elsif e.payload->>'audience'='participant' then
  if not exists(select 1 from public.assignments a where a.job_id=j.id and a.cleaner_id=u.id and (a.ended_at is null or (e.kind='cancelled' and a.end_reason='cancelled'))) then return null;end if;
 else return null;end if;
 href:=case when e.payload->>'audience'='participant' then '/cleaner?view=upcoming&date='||j.checkout_date else '/'||u.role||'?view='||case when u.role='admin' then 'jobs' else 'calendar' end||'&date='||j.checkout_date||'&job='||j.id end;
 select coalesce(nullif(display_name,''),'A cleaner') into person from public.users where id=(e.payload->>'cleanerId')::uuid;
 select count(*) into n from public.assignments where job_id=j.id and ended_at is null;
 if e.kind='assigned' then
  if j.status<>'open' or not exists(select 1 from public.assignments where id=(e.payload->>'assignmentId')::uuid and ended_at is null) then return null;end if;
  body:='You’ve been assigned to '||p.name||' on '||to_char(j.checkout_date,'Mon FMDD')||'.';
 elsif e.kind in ('joined','claimed','staffed') then
  if j.status<>'open' or not exists(select 1 from public.assignments where id=(e.payload->>'assignmentId')::uuid and ended_at is null) then return null;end if;
  body:=person||case when e.kind='joined' then ' has joined you on ' when e.kind='staffed' then ' was assigned to ' else ' claimed ' end||p.name||case when e.kind in ('claimed','staffed') then ' for '||to_char(j.checkout_date,'Mon FMDD') else '' end||'.';
 elsif e.kind='withdrawn' then
  if j.status<>'open' then return null;end if;
  if e.payload->>'audience'='participant' then
   amount:=private.expected_compensation(j.id,u.id);
   body:=person||' withdrew from '||p.name||'. '||case when n=1 then 'You’re now cleaning solo. ' else '' end||case when amount is not null then 'Expected payout: '||private.notification_money(amount)||'.' else 'Review your compensation.' end;
  else
   body:=person||' declined '||to_char(j.checkout_date,'Mon FMDD')||' at '||p.name||'. '||n||' of '||j.staffing_capacity||' assigned.';
   if n<j.staffing_capacity then body:=body||case when j.cleaning_management='private' then ' A replacement is needed.' else ' Bloom is responsible for coverage.' end;end if;
   if length(coalesce(e.payload->>'comment',''))>0 then body:=body||' “'||left(e.payload->>'comment',160)||'”';end if;
  end if;
 elsif e.kind='coverage' then
  if j.coverage_revision<>(e.payload->>'coverageRevision')::integer or j.status<>'open' or j.setup_required or j.started_at is not null or n<>0 or j.checkout_date<(p_now at time zone j.timezone_snapshot)::date then return null;end if;
  body:=p.name||' is unassigned for '||to_char(j.checkout_date,'Mon FMDD')||'.'||case when j.cleaning_management='private' then ' A replacement is needed.' else ' Bloom is responsible for coverage.' end;
 elsif e.kind='extended' then
  if j.status<>'open' or j.started_at is not null or j.guest_extension_revision<>(e.payload->>'revision')::integer then return null;end if;
  body:='The guest extended their stay at '||p.name||'. Your cleaning moved from '||to_char((e.payload->>'oldDate')::date,'Mon FMDD')||' to '||to_char(j.checkout_date,'Mon FMDD')||case when e.payload->>'audience'='participant' then '. You’re still assigned.' else '.' end;
 elsif e.kind='cancelled' then if j.status<>'cancelled' then return null;end if;body:=p.name||' on '||to_char(j.checkout_date,'Mon FMDD')||' was cancelled.';
 elsif e.kind='changed' then if j.status<>'open' then return null;end if;body:='Your cleaning at '||p.name||' on '||to_char(j.checkout_date,'Mon FMDD')||' changed. Review the details.';
 elsif e.kind='rate_changed' then
  if j.status<>'open' then return null;end if;
  amount:=private.expected_compensation(j.id,u.id);body:='Compensation updated for '||p.name||case when amount is null then '.' else '. Expected payout: '||private.notification_money(amount)||'.' end;
 elsif e.kind='compensation' then
  amount:=private.expected_compensation(j.id,u.id);if amount is null then return null;end if;
  body:='Compensation updated for '||p.name||': '||private.notification_money(amount)||'.';
 elsif e.kind='adjustment' then
  select adj.amount_cents into amount from private.payout_adjustments adj join public.assignments a on a.id=adj.assignment_id where adj.id=(e.payload->>'adjustmentId')::uuid and a.cleaner_id=u.id;
  if amount is null then return null;end if;body:='Compensation adjusted for '||p.name||': '||case when amount>0 then '+' else '−' end||private.notification_money(abs(amount))||'.';
 elsif e.kind='invitation' then
  if not exists(select 1 from private.property_cleaner_members where property_id=p.id and cleaner_id=(e.payload->>'cleanerId')::uuid and active) then return null;end if;
  body:=person||' joined your team at '||p.name||'.';href:='/owner?view=listings&property='||p.id;
 elsif e.kind='calendar' then
  if not exists(select 1 from public.calendar_sources s where s.id=(e.payload->>'sourceId')::uuid and s.enabled and s.last_error_code is not null) then return null;end if;
  body:=p.name||' calendar needs attention.';href:='/'||u.role||'?view='||case when u.role='admin' then 'properties' else 'listings' end||'&property='||p.id;
 else return null;end if;
 return jsonb_build_object('body',body,'url',href);
end $$;

-- Existing job/report pipelines stay intact. Avoid self-completion and recheck event-specific eligibility.
alter function private.push_content(uuid,timestamptz) rename to push_content_before_events;
create function private.push_content(p_message uuid,p_now timestamptz) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m private.push_messages;j public.jobs;body jsonb;person text;begin
 select * into m from private.push_messages where id=p_message;
 if m.id is null or m.expires_at<=p_now then return null;end if;
 if m.kind='event' then return private.notification_content(m.notification_event_id,p_now,true);end if;
 if m.kind='completion' then
  select * into j from public.jobs where id=m.job_ids[1];
  if m.user_id=j.completed_by then return null;end if;
  body:=private.push_content_before_events(p_message,p_now);
  if body is not null and exists(select 1 from public.assignments where job_id=j.id and cleaner_id=m.user_id and ended_at is null) then
   select display_name into person from public.users where id=j.completed_by;
   body:=jsonb_set(body,'{body}',to_jsonb(coalesce(nullif(person,''),'Your teammate')||' completed your shared cleaning at '||(select name from public.properties where id=j.property_id)||'.'));
   body:=jsonb_set(body,'{url}',to_jsonb('/cleaner?view=upcoming&date='||j.checkout_date));
  end if;return body;
 end if;
 return private.push_content_before_events(p_message,p_now);
end $$;

create function private.notify_opportunities(p_jobs uuid[],p_kind text,p_key text,p_now timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare u record;ids uuid[];begin
 for u in select * from public.users where role='cleaner' and bloom_network_enabled and bloom_pool_approved loop
  with eligible as (
   select j.id,(p_now at time zone j.timezone_snapshot)::date local_day from public.jobs j join public.properties p on p.id=j.property_id
   where j.id=any(p_jobs) and p.city_id=u.approved_city_id and j.started_at is null and private.push_claimable(j.id,p_now)
    and (p_kind='available' or not exists(select 1 from public.assignments where job_id=j.id and ended_at is null))
    and not exists(select 1 from public.assignments where job_id=j.id and cleaner_id=u.id and ended_at is null)
  ),reserved as (
   insert into private.opportunity_notifications(job_id,user_id,local_day) select id,u.id,local_day from eligible on conflict do nothing returning job_id
  ) select array_agg(job_id) into ids from reserved;
  if cardinality(ids)>0 then perform private.notification_emit(p_key,u.id,case when p_kind='available' then 'newJobs' else 'unclaimed' end,p_kind,null,null,jsonb_build_object('jobs',to_jsonb(ids)),p_now+interval '24 hours');end if;
 end loop;
end $$;
-- Immediate same-day coverage and opportunities use the same recipient/job/day ledger as timed reminders.
do $$declare definition text;begin
 definition:=pg_get_functiondef('private.notify_job_change()'::regprocedure);
 definition:=replace(definition,$needle$perform private.notify_coverage(new.id,'same-day');$needle$,$replacement$perform private.notify_coverage(new.id,'same-day');if new.cleaning_management='bloom' then perform private.notify_opportunities(array[new.id],'available','same-day:'||new.id||':'||new.checkout_date,now());end if;$replacement$);
 execute definition;
 definition:=pg_get_functiondef('private.notify_assignment_change()'::regprocedure);
 definition:=replace(definition,$needle$perform private.notify_coverage(j.id,'same-day');$needle$,$replacement$perform private.notify_coverage(j.id,'same-day');if j.cleaning_management='bloom' then perform private.notify_opportunities(array[j.id],'available','same-day:'||j.id||':'||j.checkout_date,now());end if;$replacement$);
 execute definition;
end $$;
-- The existing publisher handles import transaction batching. Same-day jobs were already emitted immediately.
create or replace function private.push_published() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if private.push_claimable(new.id,now()) then
  insert into private.push_publications(job_id,batch,city_id,consumed)
  select new.id,pg_current_xact_id()::text,p.city_id,(select activated_at is null from private.push_control) or new.checkout_date=(now() at time zone new.timezone_snapshot)::date
  from public.properties p where p.id=new.property_id on conflict do nothing;
 end if;return new;
end $$;

create function private.notify_financial_event() returns trigger language plpgsql security definer set search_path='' as $$
declare a public.assignments;begin
 if TG_TABLE_NAME='payout_payments' then
  perform private.notification_emit('payment:'||new.id,new.cleaner_id,'payments','payment',null,null,jsonb_build_object('paymentId',new.id));
 else
  select * into a from public.assignments where id=new.assignment_id;
  perform private.notification_emit('adjustment:'||new.id,a.cleaner_id,'payments','adjustment',a.job_id,(select property_id from public.jobs where id=a.job_id),jsonb_build_object('adjustmentId',new.id,'audience','participant'));
 end if;return new;
end $$;
create trigger operational_payment_notification after insert on private.payout_payments for each row execute function private.notify_financial_event();
create trigger operational_adjustment_notification after insert on private.payout_adjustments for each row execute function private.notify_financial_event();
create function private.notify_team_acceptance() returns trigger language plpgsql security definer set search_path='' as $$
declare o record;begin
 if new.status='accepted' and old.status is distinct from new.status then
  for o in select owner_id from public.property_owners where property_id=new.property_id loop
   perform private.notification_emit('invitation:'||new.id,o.owner_id,'invitations','invitation',null,new.property_id,jsonb_build_object('audience','manager','cleanerId',new.accepted_by));
  end loop;
 end if;return new;
end $$;
create trigger operational_invitation_notification after update on private.cleaner_invitations for each row execute function private.notify_team_acceptance();
create function private.notify_actionable_request() returns trigger language plpgsql security definer set search_path='' as $$
declare u record;begin
 if new.status='pending' then
  for u in select id from public.users where role='admin' loop
   perform private.notification_emit('request:'||TG_TABLE_NAME||':'||new.id,u.id,'requests','request',null,null,jsonb_build_object('requestId',new.id,'requestType',case when TG_TABLE_NAME='city_change_requests' then 'city' else 'pool' end));
  end loop;
 end if;return new;
end $$;
create trigger operational_city_request after insert on public.city_change_requests for each row execute function private.notify_actionable_request();
create trigger operational_pool_request after insert on private.bloom_pool_requests for each row execute function private.notify_actionable_request();
create function private.notify_calendar_issue() returns trigger language plpgsql security definer set search_path='' as $$
declare u record;begin
 if new.last_error_code is not null and new.last_error_code is distinct from old.last_error_code then
  for u in select actor.id from public.users actor join public.properties p on p.id=new.property_id
   where private.people_access(p.id,actor.id) and (actor.role='owner' or exists(select 1 from public.property_owners where property_id=p.id and owner_id=actor.id) or (actor.role='admin' and p.cleaning_management='bloom')) loop
   perform private.notification_emit('calendar:'||new.id||':'||pg_current_xact_id(),u.id,'calendar','calendar',null,new.property_id,jsonb_build_object('audience','manager','sourceId',new.id));
  end loop;
 end if;return new;
end $$;
create trigger operational_calendar_issue after update on public.calendar_sources for each row execute function private.notify_calendar_issue();

alter function public.bloom_push_tick(timestamptz) rename to bloom_push_tick_before_operations;
revoke all on function public.bloom_push_tick_before_operations(timestamptz) from public,anon,authenticated,service_role;
create function public.bloom_push_tick(p_now timestamptz default now()) returns integer language plpgsql security definer set search_path='' as $$
declare n integer;extra integer;c record;day date;scheduled timestamptz;ids uuid[];u record;j record;begin
 n:=public.bloom_push_tick_before_operations(p_now);
 -- Reserve legacy import alerts before considering overlapping unclaimed reminders.
 insert into private.opportunity_notifications(job_id,user_id,local_day)
 select job.id,m.user_id,(p_now at time zone job.timezone_snapshot)::date from private.push_messages m join public.jobs job on job.id=any(m.job_ids)
 where m.kind='new' and m.expires_at>p_now and private.push_claimable(job.id,p_now)
 and not exists(select 1 from public.assignments where job_id=job.id and cleaner_id=m.user_id and ended_at is null) on conflict do nothing;
 -- Each property-local date is evaluated separately, independent of the server timezone.
 for c in select distinct timezone_snapshot zone from public.jobs loop
  day:=(p_now at time zone c.zone)::date;scheduled:=(day+time '08:00') at time zone c.zone;
  if p_now>=scheduled and p_now<scheduled+interval '1 hour' then
   select array_agg(job.id) into ids from public.jobs job where job.timezone_snapshot=c.zone and job.checkout_date in(day+3,day+1)
    and private.push_claimable(job.id,p_now) and not exists(select 1 from public.assignments where job_id=job.id and ended_at is null);
   if cardinality(ids)>0 then perform private.notify_opportunities(ids,'unclaimed','unclaimed:'||c.zone||':'||day,p_now);end if;
   for j in select job.id,job.checkout_date from public.jobs job where job.timezone_snapshot=c.zone and job.status='open' and not job.setup_required and job.started_at is null and job.checkout_date in(day+3,day+1,day)
    and not exists(select 1 from public.assignments where job_id=job.id and ended_at is null) loop
    perform private.notify_coverage(j.id,'scheduled:'||day);
   end loop;
  end if;
 end loop;
 -- Weekly payer summaries, never one push per completion. Timezone is the configured payer city timezone.
 for u in select actor.id,actor.role,coalesce(city.notification_timezone,'America/Detroit') zone from public.users actor left join public.cities city on city.id=actor.approved_city_id where actor.role in ('admin','owner') loop
  day:=(p_now at time zone u.zone)::date;scheduled:=(day+time '09:00') at time zone u.zone;
  if extract(isodow from day)=1 and p_now>=scheduled and p_now<scheduled+interval '1 hour' and exists(
   select 1 from private.payout_balances b where b.remaining_cents>0 and ((u.role='admin' and b.payer_owner_id is null) or (u.role='owner' and b.payer_owner_id=u.id))) then
   perform private.notification_emit('payout-summary:'||day,u.id,'payouts','payouts',null,null,'{}',scheduled+interval '24 hours');
  end if;
 end loop;
 insert into private.push_deliveries(message_id,device_id,generation)
 select m.id,d.id,d.generation from private.push_messages m join private.push_device_accounts a on a.user_id=m.user_id and a.enabled join private.push_devices d on d.id=a.device_id and d.verified
 where m.kind='event' and m.expires_at>p_now and a.linked_at<=m.created_at and d.updated_at<=m.created_at and private.push_content(m.id,p_now) is not null on conflict do nothing;
 get diagnostics extra=row_count;return n+extra;
end $$;
revoke all on function public.bloom_push_tick(timestamptz) from public,anon,authenticated;
grant execute on function public.bloom_push_tick(timestamptz) to service_role;

alter function private.inbox_items() rename to inbox_items_before_operations;
create function private.inbox_items() returns table(id text,body text,href text,dismissible boolean) language plpgsql stable security definer set search_path='' as $$
declare actor public.users;begin
 actor:=private.require_actor();
 return query select i.id,i.body,i.href,i.dismissible from private.inbox_items_before_operations() i
 where i.id not like 'payment:%'
 and not exists(select 1 from private.notification_events e where e.user_id=actor.id and i.id='assignment:'||(e.payload->>'assignmentId') and e.kind='assigned')
 and not exists(select 1 from private.team_notices t where i.id='team:'||t.id and exists(select 1 from private.notification_events e where e.user_id=actor.id and e.property_id=t.property_id and (e.job_id=t.job_id or (e.kind='invitation' and t.job_id is null))))
 and not exists(select 1 from public.jobs j where i.id='completion:'||j.id and j.completed_by=actor.id)
 and not exists(select 1 from public.jobs j where i.id='staffing:'||j.id and j.cleaning_management='private' and actor.role='admin');
 return query select 'event:'||e.id,c.value->>'body',c.value->>'url',true
 from private.notification_events e cross join lateral(select private.notification_content(e.id,now(),false) value)c
 where e.user_id=actor.id and e.kind<>'payment' and c.value is not null;
 -- The existing committed external-payment ledger remains the source of truth, including grouped history.
 if actor.role in ('cleaner','admin') then
  return query select 'payment:'||e.batch_id::text||':'||count(*)::text,
   case when pp.payer_owner_id is null then 'Bloom' else coalesce(nullif(payer.display_name,''),'Your owner') end||' sent you '||private.notification_money(sum(pp.amount_cents)::bigint)||'.',
   '/cleaner?view=payouts&history=payments&payer='||coalesce(pp.payer_owner_id::text,'bloom'),true
  from private.payout_notification_events e join private.payout_payments pp on pp.id=e.payment_id
  left join public.users payer on payer.id=pp.payer_owner_id
  where pp.cleaner_id=actor.id and not exists(select 1 from private.payout_voids v where v.payment_id=pp.id)
  group by e.batch_id,pp.payer_owner_id,payer.display_name;
 end if;
end $$;
alter function private.notification_created_at(text) rename to notification_created_at_before_operations;
create function private.notification_created_at(p_key text) returns timestamptz language sql stable set search_path='' as $$
 select coalesce((select created_at from private.notification_events where p_key='event:'||id),private.notification_created_at_before_operations(p_key));
$$;
-- No new public table grants or scheduler activation. Only the existing service boundary can dispatch.
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='private' and p.proname in(
 'notification_preference','notification_emit','expected_compensation','notification_money','notify_managers','notify_coverage','notify_assignment_change','notify_job_change','notification_content','push_content_before_events','push_content','notify_opportunities','notify_financial_event','notify_team_acceptance','notify_actionable_request','notify_calendar_issue','inbox_items_before_operations','inbox_items','notification_created_at_before_operations','notification_created_at') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $$;

-- Store report provenance, but notify once per unchanged issue episode rather than per cleaning.
create table private.report_notification_state(property_id uuid references public.properties,kind text,job_id uuid references public.jobs,details text,episode uuid not null default gen_random_uuid(),active boolean not null,primary key(property_id,kind));
revoke all on private.report_notification_state from public,anon,authenticated,service_role;
-- Keep historic report inserts; the episode publisher below owns new report push generation.
do $$declare definition text;start_at integer;end_at integer;begin
 definition:=pg_get_functiondef('private.record_property_report_alerts()'::regprocedure);
 start_at:=position('  if (select activated_at is not null' in definition);
 end_at:=position(' end if;'||chr(10)||' return new;' in definition);
 if start_at=0 or end_at=0 then raise exception 'Report publisher insertion point changed';end if;
 definition:=substr(definition,1,start_at-1)||substr(definition,end_at);
 execute definition;
end $$;
create function private.notify_report_episode() returns trigger language plpgsql security definer set search_path='' as $$
declare k text;details text;prior private.report_notification_state;episode_id uuid;u record;begin
 if new.status<>'completed' or old.status='completed' then return new;end if;
 foreach k in array array['low_supplies','maintenance'] loop
  details:=private.active_report_details(new.id,k);
  select * into prior from private.report_notification_state where property_id=new.property_id and kind=k for update;
  if k='low_supplies' and exists(select 1 from private.supply_purchases purchase join public.job_supply_reports report on report.job_id=prior.job_id and report.supply_id=purchase.supply_id and report.level in ('low','empty') where purchase.property_id=new.property_id and purchase.restocked_at>report.reported_at) then prior.active:=false;end if;
  episode_id:=case when prior.active and prior.details is not distinct from details then prior.episode else gen_random_uuid() end;
  insert into private.report_notification_state(property_id,kind,job_id,details,episode,active) values(new.property_id,k,new.id,details,episode_id,details is not null)
  on conflict(property_id,kind) do update set job_id=excluded.job_id,details=excluded.details,episode=excluded.episode,active=excluded.active;
  if details is not null and (not coalesce(prior.active,false) or prior.details is distinct from details) then
   for u in select actor.id from public.users actor where private.people_access(new.property_id,actor.id) and (actor.role='owner' or exists(select 1 from public.property_owners where property_id=new.property_id and owner_id=actor.id) or (actor.role='admin' and new.cleaning_management='bloom')) loop
    perform private.notification_emit('report:'||episode_id,u.id,case when k='low_supplies' then 'lowSupplies' else 'maintenance' end,'report',new.id,new.property_id,jsonb_build_object('audience','manager','reportKind',k,'episode',episode_id));
   end loop;
  end if;
 end loop;return new;
end $$;
create trigger zzzz_notify_report_episode after update of status on public.jobs for each row execute function private.notify_report_episode();
-- A held job is actionable for its responsible manager, without claiming that coverage is in progress.
do $$declare definition text;begin
 definition:=pg_get_functiondef('private.notify_job_change()'::regprocedure);
 definition:=replace(definition,$needle$ elsif new.status='cancelled'$needle$,$replacement$ elsif new.review_required and not old.review_required then kind:='review';
 elsif new.status='cancelled'$replacement$);
 execute definition;
 definition:=pg_get_functiondef('private.notification_content(uuid,timestamptz,boolean)'::regprocedure);
 definition:=replace(definition,$needle$ elsif e.kind='calendar' then$needle$,$replacement$ elsif e.kind='review' then
  if not j.review_required then return null;end if;body:=p.name||' cleaning needs calendar review.';
 elsif e.kind='report' then
  select private.active_report_details(state.job_id,state.kind) into label from private.report_notification_state state
   where state.property_id=p.id and state.kind=e.payload->>'reportKind' and state.active and state.episode=(e.payload->>'episode')::uuid;
  if label is null then return null;end if;
  body:=p.name||case when e.payload->>'reportKind'='low_supplies' then ': low supplies — ' else ': maintenance — ' end||label||'.';
  href:='/'||u.role||'?view='||case when u.role='admin' then 'activity&job='||(select job_id from private.report_notification_state where property_id=p.id and kind=e.payload->>'reportKind') else 'listings&property='||p.id||'&section='||case when e.payload->>'reportKind'='low_supplies' then 'supplies' else 'maintenance' end end;
 elsif e.kind='calendar' then$replacement$);
 execute definition;
 definition:=pg_get_functiondef('private.inbox_items()'::regprocedure);
 definition:=replace(definition,$needle$ where i.id not like 'payment:%'$needle$,$replacement$ where i.id not like 'payment:%'
 and not exists(select 1 from private.report_notification_state state join public.jobs job on job.property_id=state.property_id where i.id=state.kind||':'||job.id)$replacement$);
 execute definition;
end $$;
revoke all on function private.notify_report_episode() from public,anon,authenticated,service_role;

create function private.notify_completion_teammates() returns trigger language plpgsql security definer set search_path='' as $$
declare a record;j public.jobs;begin
 select * into j from public.jobs where id=new.job_id;
 for a in select cleaner_id from public.assignments where job_id=j.id and ended_at is null and cleaner_id<>j.completed_by loop
  perform private.notification_emit('completed:'||j.id,a.cleaner_id,'completions','completed',j.id,j.property_id,jsonb_build_object('audience','participant','cleanerId',j.completed_by));
 end loop;return new;
end $$;
create trigger operational_teammate_completion after insert on private.cleaning_activity_events for each row execute function private.notify_completion_teammates();
do $$declare definition text;begin
 definition:=pg_get_functiondef('private.notification_content(uuid,timestamptz,boolean)'::regprocedure);
 definition:=replace(definition,$needle$ elsif e.kind='compensation' then$needle$,$replacement$ elsif e.kind='completed' then
  if j.status<>'completed' or j.completed_by=u.id then return null;end if;
  body:=coalesce(person,'Your teammate')||' completed your shared cleaning at '||p.name||'.';
 elsif e.kind='compensation' then$replacement$);
 execute definition;
 definition:=pg_get_functiondef('private.push_content(uuid,timestamptz)'::regprocedure);
 definition:=replace(definition,$needle$  if m.user_id=j.completed_by then return null;end if;$needle$,$replacement$  if m.user_id=j.completed_by or exists(select 1 from private.notification_events e where e.user_id=m.user_id and e.job_id=j.id and e.kind='completed') then return null;end if;$replacement$);
 execute definition;
end $$;
revoke all on function private.notify_completion_teammates() from public,anon,authenticated,service_role;
commit;
