begin;
alter table public.users add column bloom_network_enabled boolean not null default true;
alter table public.properties add column cleaning_management text not null default 'bloom' check(cleaning_management in ('bloom','private')),add column bloom_approved boolean not null default true,add column bloom_request_status text not null default 'none' check(bloom_request_status in ('none','pending','accepted','unavailable')),add column private_capacity integer not null default 1 check(private_capacity between 1 and 20),add column private_total_cents integer not null default 9000 check(private_total_cents between 20 and 100000000),add column private_payer_id uuid references public.users,add column bloom_host_charge_cents integer check(bloom_host_charge_cents between 0 and 100000000);
alter table public.jobs add column cleaning_management text not null default 'bloom' check(cleaning_management in ('bloom','private')),add column payer_owner_id uuid references public.users,add column staffing_capacity integer not null default 2 check(staffing_capacity between 1 and 20),add column compensation_mode text not null default 'equal' check(compensation_mode in ('equal','individual')),add column private_total_cents_snapshot integer,add column bloom_coverage_requested boolean not null default false,add column host_charge_cents_snapshot integer check(host_charge_cents_snapshot between 0 and 100000000);
alter table public.assignments drop constraint assignments_slot_check;
alter table public.assignments add constraint assignments_slot_check check(slot between 1 and 20),add column agreed_pay_cents integer check(agreed_pay_cents between 1 and 100000000),add column withdrawal_comment text,add column needs_resolution boolean not null default false;
create table private.property_cleaner_members(property_id uuid references public.properties,cleaner_id uuid references public.users,active boolean not null default true,default_assigned boolean not null default false,individual_amount_cents integer check(individual_amount_cents between 1 and 100000000),joined_at timestamptz not null default now(),primary key(property_id,cleaner_id));
create table private.team_notices(id uuid primary key default gen_random_uuid(),user_id uuid references public.users,property_id uuid references public.properties,job_id uuid references public.jobs,body text not null,created_at timestamptz not null default now());
create function private.team_member(p_property uuid,p_user uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from private.property_cleaner_members where property_id=p_property and cleaner_id=p_user and active)$$;
create function private.team_notice(p_property uuid,p_job uuid,p_body text,p_user uuid default null) returns void language sql security definer set search_path='' as $$insert into private.team_notices(user_id,property_id,job_id,body) select p_user,p_property,p_job,p_body where p_user is not null union all select owner_id,p_property,p_job,p_body from public.property_owners where property_id=p_property and p_user is null$$;
create function private.initial_management() returns trigger language plpgsql set search_path='' as $$begin if new.owner_created then new.cleaning_management:='private';new.bloom_approved:=false;end if;return new;end$$;
create trigger initial_management before insert on public.properties for each row execute function private.initial_management();
create function private.snapshot_management() returns trigger language plpgsql security definer set search_path='' as $$declare p public.properties;begin select * into p from public.properties where id=new.property_id;new.cleaning_management:=p.cleaning_management;new.host_charge_cents_snapshot:=case when p.cleaning_management='bloom' then p.bloom_host_charge_cents else null end;if p.cleaning_management='private' then new.payer_owner_id:=coalesce(p.private_payer_id,(select owner_id from public.property_owners where property_id=p.id order by owner_id limit 1));if new.payer_owner_id is null then raise exception 'CONFIGURATION_ERROR';end if;new.staffing_capacity:=p.private_capacity;new.private_total_cents_snapshot:=p.private_total_cents;new.compensation_mode:=case when exists(select 1 from private.property_cleaner_members where property_id=p.id and active and default_assigned and individual_amount_cents is not null) then 'individual' else 'equal' end;end if;return new;end$$;
create trigger snapshot_management before insert on public.jobs for each row execute function private.snapshot_management();
create function private.autoassign_private() returns trigger language plpgsql security definer set search_path='' as $$declare m record;s integer:=0;begin if new.cleaning_management<>'private' or new.setup_required or new.status<>'open' then return new;end if;if TG_OP='UPDATE' and not old.setup_required then return new;end if;for m in select t.* from private.property_cleaner_members t join public.users u on u.id=t.cleaner_id where t.property_id=new.property_id and t.active and t.default_assigned and u.role='cleaner' and u.onboarding_completed_at is not null order by t.cleaner_id limit new.staffing_capacity loop s:=s+1;insert into public.assignments(job_id,cleaner_id,slot,agreed_pay_cents) values(new.id,m.cleaner_id,s,m.individual_amount_cents);perform private.team_notice(new.property_id,new.id,'You have been assigned a private cleaning.',m.cleaner_id);end loop;if s<new.staffing_capacity then perform private.team_notice(new.property_id,new.id,'Your cleaning needs additional team members.');end if;return new;end$$;
create trigger zz_autoassign_private after insert or update of setup_required on public.jobs for each row execute function private.autoassign_private();
create function private.job_visible(p_job uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.jobs j join public.properties p on p.id=j.property_id cross join lateral private.actor() u where j.id=p_job and (u.role='admin' or private.assigned(j.id) or (u.role='cleaner' and ((j.cleaning_management='private' and private.team_member(p.id,u.id)) or (j.cleaning_management='bloom' and u.bloom_network_enabled and p.city_id=u.approved_city_id)))))$$;
create policy private_job_boundary on public.jobs as restrictive for select to authenticated using(private.job_visible(id));
create or replace function public.bloom_me() returns jsonb language plpgsql stable security definer set search_path='' as $$declare u public.users;begin u:=private.require_actor();return jsonb_build_object('id',u.id,'role',u.role,'displayName',u.display_name,'approvedCityId',u.approved_city_id,'bloomNetworkEnabled',u.bloom_network_enabled);end$$;
create or replace function public.bloom_jobs(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$declare u public.users;begin u:=private.require_actor();if u.role='owner' then raise exception 'FORBIDDEN';end if;if p_from is null or p_to is null or p_to<p_from or p_to-p_from>92 then raise exception 'VALIDATION_ERROR';end if;return(select coalesce(jsonb_agg(private.job_dto(j.id) order by j.start_at,j.id),'[]') from public.jobs j where (not j.setup_required or u.role='admin') and j.checkout_date between p_from and p_to and private.job_visible(j.id));end$$;
alter function private.job_dto(uuid) rename to job_dto_before_teams;
create function private.job_dto(p_job uuid) returns jsonb language sql stable security definer set search_path='' as $$select private.job_dto_before_teams(p_job)||jsonb_build_object('management',j.cleaning_management,'payerId',j.payer_owner_id,'payerName',coalesce((select display_name from public.users where id=j.payer_owner_id),'Bloom'),'capacity',j.staffing_capacity,'compensationMode',j.compensation_mode,'myAgreedPayCents',(select agreed_pay_cents from public.assignments where job_id=j.id and cleaner_id=(private.actor()).id and ended_at is null),'staffingNeedsResolution',(select count(*)<j.staffing_capacity or coalesce(bool_or(needs_resolution),false) from public.assignments where job_id=j.id and ended_at is null),'bloomCoverageRequested',j.bloom_coverage_requested,'soloRateCents',case when j.cleaning_management='private' then j.private_total_cents_snapshot else j.solo_rate_cents_snapshot end,'sharedRateCents',case when j.cleaning_management='private' then j.private_total_cents_snapshot/greatest(1,(select count(*)::integer from public.assignments where job_id=j.id and ended_at is null)) else j.solo_rate_cents_snapshot/2 end) from public.jobs j where j.id=p_job$$;
create function public.bloom_cleaner_network(p_enabled boolean,p_city uuid default null,p_key text default null) returns jsonb language plpgsql security definer set search_path='' as $$declare u public.users;r jsonb;input jsonb:=jsonb_build_object('enabled',p_enabled,'city',p_city);begin u:=private.require_actor('cleaner');select * into u from public.users where id=u.id for update;if p_key is not null then r:=private.receipt('cleaner_network',p_key,input);if r is not null then return r;end if;end if;if p_enabled is null then raise exception 'VALIDATION_ERROR';end if;if p_enabled then if u.initial_city_selected_at is null then if p_city is null or not exists(select 1 from public.cities where id=p_city and active) then raise exception 'VALIDATION_ERROR';end if;update public.users set approved_city_id=p_city,initial_city_selected_at=now() where id=u.id;elsif p_city is not null and p_city is distinct from u.approved_city_id then raise exception 'CONFLICT';elsif not exists(select 1 from public.cities where id=u.approved_city_id and active) then raise exception 'CITY_MISMATCH';end if;end if;update public.users set bloom_network_enabled=p_enabled where id=u.id;if p_key is not null then return private.save_receipt('cleaner_network',p_key,input,public.bloom_me());end if;return public.bloom_me();end$$;
create or replace function private.job_action_v1(p_job uuid,p_action text,p_key text,p_expected_version integer default null,p_payload jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;j public.jobs;p public.properties;a public.assignments; n integer;s smallint;r jsonb;b jsonb;t timestamptz;
 target public.users;input jsonb:=jsonb_build_object('job',p_job,'action',p_action,'version',p_expected_version,'payload',p_payload);begin
 u:=private.require_actor();
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or exists(select 1 from jsonb_object_keys(p_payload) k where not (k=any(case p_action when 'withdraw' then array['comment'] when 'cancel' then array['reason'] when 'reassign' then array['reason','cleanerId','removeAssignmentId'] when 'keep' then array['reason'] when 'reschedule' then array['reason','checkoutDate'] else array[]::text[] end))) then raise exception 'VALIDATION_ERROR';end if;
 if p_action in ('cancel','reassign','keep','reschedule') then if u.role<>'admin' then raise exception 'FORBIDDEN';end if;
 elsif p_action in ('claim','withdraw','complete') then if u.role not in ('cleaner','admin') then raise exception 'FORBIDDEN';end if;else raise exception 'VALIDATION_ERROR';end if;
 r:=private.receipt('job_action',p_key,input);if r is not null then return r;end if;
 select * into j from public.jobs where id=p_job for update;if not found then raise exception 'NOT_FOUND';end if;
 select * into p from public.properties where id=j.property_id;
 select * into a from public.assignments where job_id=j.id and cleaner_id=u.id and ended_at is null;
 if u.role='cleaner' and j.cleaning_management='private' and not private.job_visible(j.id) then raise exception 'NOT_FOUND';end if;
 if u.role='cleaner' and j.cleaning_management='bloom' and a.id is null and p.city_id is distinct from u.approved_city_id then raise exception 'CITY_MISMATCH';end if;
 if p_action='complete' and j.status='completed' and a.id is not null then return private.save_receipt('job_action',p_key,input,private.job_dto(j.id));end if;
 if j.status<>'open' then raise exception 'INVALID_STATE';end if;
 if p_action in ('cancel','reassign','keep','reschedule') and (p_expected_version is null or p_expected_version<>j.version) then raise exception 'CONFLICT';end if;
 if p_action in ('cancel','reassign','keep','reschedule') and (coalesce(length(trim(p_payload->>'reason')),0)=0) then raise exception 'VALIDATION_ERROR';end if;
 t:=clock_timestamp();b:=private.job_snapshot(j.id);
 if p_action='claim' then
 if j.cleaning_management='private' or (u.role='cleaner' and not u.bloom_network_enabled) then raise exception 'FORBIDDEN';end if;
 if j.review_required then raise exception 'REVIEW_REQUIRED';end if;
 if not p.active or not exists(select 1 from public.cities where id=p.city_id and active) or t>=j.end_at then raise exception 'INVALID_STATE';end if;
 -- Lock the user's city against concurrent admin approval while checking eligibility.
 select * into u from public.users where id=u.id for update;
 t:=clock_timestamp();if t>=j.end_at then raise exception 'INVALID_STATE';end if;
 if u.role='cleaner' and not u.bloom_network_enabled then raise exception 'FORBIDDEN';end if;
 if u.role not in ('cleaner','admin') or (u.role='cleaner' and p.city_id is distinct from u.approved_city_id) then raise exception 'CITY_MISMATCH';end if;
 if a.id is not null then raise exception 'ALREADY_ASSIGNED';end if;
 select candidate into s from generate_series(1,2) candidate where not exists(select 1 from public.assignments x where x.job_id=j.id and x.slot=candidate and x.ended_at is null) order by candidate limit 1;
 if s is null then raise exception 'JOB_FULL';end if;
 insert into public.assignments(job_id,cleaner_id,slot,claimed_at) values(j.id,u.id,s,t);
 elsif p_action='withdraw' then
 if a.id is null then raise exception 'NOT_FOUND';end if;
 if j.cleaning_management='private' and coalesce(length(trim(p_payload->>'comment')),0) not between 1 and 1000 then raise exception 'VALIDATION_ERROR';end if;
 if j.cleaning_management='bloom' and not private.withdrawal_allowed(t,j.start_at) then raise exception 'WITHDRAWAL_DEADLINE';end if;
 update public.assignments set ended_at=t,end_reason='withdrawn',withdrawal_comment=p_payload->>'comment' where id=a.id;
 if j.cleaning_management='private' then perform private.team_notice(j.property_id,j.id,'A cleaner withdrew. A replacement is needed. Comment: '||(p_payload->>'comment'));end if;
 elsif p_action='complete' then
 if a.id is null then raise exception 'NOT_FOUND';end if;
 if j.review_required then raise exception 'REVIEW_REQUIRED';end if;
 if t<j.start_at then raise exception 'INVALID_STATE';end if;
 if j.cleaning_config is null or exists(select 1 from jsonb_array_elements(j.cleaning_config->'rooms') room where not exists(select 1 from public.job_photos ph where ph.job_id=j.id and ph.state='ready' and ph.room_id=(room->>'id')::uuid)) then raise exception 'PHOTO_COVERAGE_REQUIRED';end if;
 select count(*) into n from public.assignments where job_id=j.id and ended_at is null;
 if j.cleaning_management='private' then
 if j.compensation_mode='individual' and exists(select 1 from public.assignments where job_id=j.id and ended_at is null and agreed_pay_cents is null) then raise exception 'REVIEW_REQUIRED';end if;
 with ranked as(select id,row_number() over(order by cleaner_id,id) ordinal from public.assignments where job_id=j.id and ended_at is null) update public.assignments a2 set completed_pay_cents=case when j.compensation_mode='individual' then a2.agreed_pay_cents else j.private_total_cents_snapshot/n+case when ranked.ordinal<=j.private_total_cents_snapshot%n then 1 else 0 end end from ranked where a2.id=ranked.id;
 else update public.assignments set completed_pay_cents=j.solo_rate_cents_snapshot/n where job_id=j.id and ended_at is null;end if;
 update public.jobs set status='completed',completed_at=t,completed_by=u.id,version=version+1,updated_at=t where id=j.id;
 elsif p_action='cancel' then
 update public.assignments set ended_at=t,end_reason='cancelled' where job_id=j.id and ended_at is null;
 update public.jobs set status='cancelled',review_required=false where id=j.id;
 elsif p_action='reassign' then
 if j.cleaning_management='private' then raise exception 'INVALID_STATE';end if;
 select * into target from public.users where id=(p_payload->>'cleanerId')::uuid for update;
 if target.id is null or target.role not in ('cleaner','admin') or (target.role='cleaner' and target.approved_city_id is distinct from p.city_id) then raise exception 'CITY_MISMATCH';end if;
 if exists(select 1 from public.assignments where job_id=j.id and cleaner_id=target.id and ended_at is null) then raise exception 'ALREADY_ASSIGNED';end if;
 select * into a from public.assignments where id=(p_payload->>'removeAssignmentId')::uuid and job_id=j.id and ended_at is null;
 if a.id is null then raise exception 'NOT_FOUND';end if;
 update public.assignments set ended_at=t,end_reason='reassigned' where id=a.id;
 insert into public.assignments(job_id,cleaner_id,slot,claimed_at) values(j.id,target.id,a.slot,t);
 elsif p_action in ('keep','reschedule') then
 if not j.review_required then raise exception 'INVALID_STATE';end if;
 if p_action='reschedule' then
 if p_payload->>'checkoutDate' is null then raise exception 'VALIDATION_ERROR';end if;
 update public.jobs set checkout_date=(p_payload->>'checkoutDate')::date,
 start_at=((p_payload->>'checkoutDate')::date+time '11:00') at time zone timezone_snapshot,
 end_at=((p_payload->>'checkoutDate')::date+time '15:00') at time zone timezone_snapshot where id=j.id;
 end if;update public.jobs set review_required=false where id=j.id;
 end if;
 if p_action<>'complete' then update public.jobs set version=version+1,updated_at=t where id=j.id;end if;
 if p_action in ('keep','reschedule','cancel') then
 update public.calendar_changes set acknowledged_at=t,acknowledged_by=u.id where job_id=j.id and acknowledged_at is null;
 end if;
 perform private.audit(j.id,p_action,b,p_key,p_payload);
 return private.save_receipt('job_action',p_key,input,private.job_dto(j.id));end $$;

create or replace function public.bloom_job_supplies(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u public.users;j public.jobs;p public.properties;begin
 u:=private.require_actor();if u.role not in ('cleaner','admin') then raise exception 'FORBIDDEN';end if;
 select * into j from public.jobs where id=p_job;select * into p from public.properties where id=j.property_id;
 if not private.job_visible(p_job) then raise exception 'NOT_FOUND';end if;
 if j.id is null or p.deleted_at is not null or (u.role<>'admin' and not private.assigned(p_job) and (j.status<>'open' or j.setup_required or not p.active or (j.cleaning_management='bloom' and p.city_id is distinct from u.approved_city_id))) then raise exception 'NOT_FOUND';end if;
 return jsonb_build_object('supplies',coalesce(j.cleaning_config->'supplies',p.cleaning_config->'supplies','[]'::jsonb),
 'reports',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from
 (select distinct on (r.supply_id) r.supply_id as "supplyId",r.level,r.reported_at as "reportedAt" from public.job_supply_reports r join public.jobs old on old.id=r.job_id where old.property_id=p.id and old.status='completed' order by r.supply_id,r.reported_at desc,r.job_id desc)x));
end $$;
create or replace function private.push_claimable(p_job uuid,p_now timestamptz) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.jobs j join public.properties p on p.id=j.property_id join public.cities c on c.id=p.city_id
 where j.cleaning_management='bloom' and j.id=p_job and j.status='open' and not j.review_required and j.end_at>p_now and p.active and p.deleted_at is null and c.active
 and (select count(*) from public.assignments a where a.job_id=j.id and a.ended_at is null)<2)
$$;
create or replace function private.push_content(p_message uuid,p_now timestamptz) returns jsonb language plpgsql stable set search_path='' as $$
declare m private.push_messages; n integer; first_date date; city text; u public.users;s private.push_preferences;begin
 select * into m from private.push_messages where id=p_message;
 select * into u from public.users where id=m.user_id;
 select * into s from private.push_preferences where user_id=m.user_id;
 if m.id is null or m.expires_at<=p_now or u.role<>'cleaner' then return null;end if;
 if m.kind='test' then return jsonb_build_object('body','Notifications are enabled on this device.','url','/cleaner?notifications=1');end if;
 select name into city from public.cities where id=m.city_id;
 if city is null then return null;end if;
 if m.kind='new' then
  if not exists(select 1 from public.cities where id=m.city_id and active) or not u.bloom_network_enabled or not coalesce(s.new_jobs,false) or u.approved_city_id is distinct from m.city_id then return null;end if;
  select count(*),min(j.checkout_date) into n,first_date from public.jobs j where j.id=any(m.job_ids) and private.push_claimable(j.id,p_now)
   and not exists(select 1 from public.assignments a where a.job_id=j.id and a.cleaner_id=u.id and a.ended_at is null);
 else
  if not coalesce(s.reminders,false) then return null;end if;
  select count(distinct j.id) into n from public.jobs j join public.properties p on p.id=j.property_id join public.assignments a on a.job_id=j.id
   where p.city_id=m.city_id and p.active and p.deleted_at is null and j.status='open' and j.end_at>p_now and j.checkout_date=m.job_date
   and a.cleaner_id=u.id and a.ended_at is null and a.claimed_at<=m.cutoff;
 end if;
 if n=0 then return null;end if;
 return jsonb_build_object('body',case when m.kind='new' then n||' new cleaning'||case when n=1 then '' else 's' end||' available in '||city||'. Tap to view.'
 else 'You have '||n||' cleaning'||case when n=1 then '' else 's' end||case when m.kind='evening' then ' tomorrow. Tap to view your jobs.' else ' today. Tap to view your schedule.' end end,
 'url',case when m.kind='new' then '/cleaner?view=calendar&city='||m.city_id||'&date='||first_date else '/cleaner?view=upcoming&date='||m.job_date end,'count',n);
end $$;
create or replace function private.inbox_items() returns table(id text,body text,href text,dismissible boolean)
language plpgsql stable security definer set search_path='' as $$
declare u public.users; m private.push_messages; n integer; day date; city text; p jsonb;begin
 u:=private.require_actor();
 return query select 'team:'||t.id,t.body,case when u.role='cleaner' then '/cleaner?view=upcoming' else '/owner?view=listings' end,true from private.team_notices t where t.user_id=u.id and t.created_at>now()-interval '30 days' and (t.job_id is null or exists(select 1 from public.jobs j where j.id=t.job_id and j.status='open')); 
 if u.role='admin' then
  for p in select value from jsonb_array_elements(public.bloom_admin_pricing()) loop
   id:='pricing:'||(p->>'id');body:=(p->>'name')||' needs cleaner pricing set';href:='/admin?view=properties&property='||(p->>'id')||'&section=settings';dismissible:=false;return next;
  end loop;
  for p in select value from jsonb_array_elements(public.bloom_admin_payouts()->'people') loop
   if (p->>'totalDueCents')::bigint>0 then
    id:='payout:'||(p->>'id');body:=(p->>'name')||' has $'||to_char((p->>'totalDueCents')::numeric/100,'FM999999990.00')||' in outstanding payments';href:='/admin?view=payouts&cleaner='||(p->>'id');dismissible:=false;return next;
   end if;
  end loop;
 end if;
 if u.role in ('owner','admin') then
  return query select 'sync:'||s.id,p.name||' calendar needs attention',case when u.role='admin' then '/admin?view=properties&property='||p.id else '/owner?view=listings' end,false
   from public.calendar_sources s join public.properties p on p.id=s.property_id
   where p.deleted_at is null and p.active and s.enabled and s.last_error_code is not null
   and (u.role='admin' or exists(select 1 from public.property_owners po where po.property_id=p.id and po.owner_id=u.id));
  return query select 'change:'||c.id,p.name||case c.type when 'removed' then ': calendar booking removed.' else ': calendar dates changed.' end,
   case when u.role='admin' then '/admin?view=properties&property='||p.id else '/owner' end,true
   from public.calendar_changes c join public.calendar_events e on e.id=c.event_id join public.calendar_sources s on s.id=e.source_id join public.properties p on p.id=s.property_id
   where c.acknowledged_at is null and c.type in ('changed','removed') and c.created_at>now()-interval '30 days' and e.end_local_date>=current_date
   and p.deleted_at is null and p.active and (u.role='admin' or exists(select 1 from public.property_owners po where po.property_id=p.id and po.owner_id=u.id));
 end if;
 if u.role='cleaner' then
  for m in select * from private.push_messages where user_id=u.id and kind<>'test' and created_at>now()-interval '7 days' order by created_at desc loop
   if m.kind='new' then
    if not u.bloom_network_enabled or u.approved_city_id is distinct from m.city_id then continue;end if;
    select count(*),min(j.checkout_date) into n,day from public.jobs j where j.id=any(m.job_ids) and private.push_claimable(j.id,now())
     and not exists(select 1 from public.assignments a where a.job_id=j.id and a.cleaner_id=u.id and a.ended_at is null);
    select name into city from public.cities where public.cities.id=m.city_id;
    body:=n||' new cleaning'||case when n=1 then '' else 's' end||' available in '||city||'.';
    href:='/cleaner?view=calendar&city='||m.city_id||'&date='||day;
   else
    select count(distinct j.id) into n from public.assignments a join public.jobs j on j.id=a.job_id join public.properties p on p.id=j.property_id
     where a.cleaner_id=u.id and a.ended_at is null and a.claimed_at<=m.cutoff and j.status='open' and j.end_at>now() and j.checkout_date=m.job_date
     and p.city_id=m.city_id and p.active and p.deleted_at is null;
    body:=n||' claimed cleaning'||case when n=1 then '' else 's' end||' on '||to_char(m.job_date,'Mon DD')||'.';
    href:='/cleaner?view=upcoming&date='||m.job_date;
   end if;
   if n>0 then id:='push:'||m.id;dismissible:=true;return next;end if;
  end loop;
 end if;
end $$;
create table private.cleaner_invitations(like private.property_invitations including defaults including constraints);
alter table private.cleaner_invitations add primary key(id);
create unique index one_cleaner_invitation on private.cleaner_invitations(property_id,email) where status in ('pending','sent');
alter table private.cleaner_invitations drop constraint property_invitations_status_check;
alter table private.cleaner_invitations add check(status in ('pending','sent','accepted','expired','revoked'));
create function public.bloom_property_team(p_property uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare u public.users;p public.properties;begin u:=private.require_actor();if not private.people_access(p_property,u.id) then raise exception 'NOT_FOUND';end if;select * into p from public.properties where id=p_property;return jsonb_build_object('propertyId',p.id,'management',p.cleaning_management,'bloomApproved',p.bloom_approved,'requestStatus',p.bloom_request_status,'capacity',p.private_capacity,'totalCents',p.private_total_cents,'payerOwnerId',p.private_payer_id,'hostChargeCents',p.bloom_host_charge_cents,
'members',coalesce((select jsonb_agg(jsonb_build_object('id',u2.id,'name',u2.display_name,'defaultAssigned',m.default_assigned,'individualAmountCents',m.individual_amount_cents,'needsResolution',exists(select 1 from public.assignments a join public.jobs j on j.id=a.job_id where j.property_id=p.id and a.cleaner_id=u2.id and a.ended_at is null and j.status='open' and a.needs_resolution))) from private.property_cleaner_members m join public.users u2 on u2.id=m.cleaner_id where m.property_id=p.id and m.active),'[]'),
'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'email',email,'status',case when status in ('pending','sent') and expires_at<=now() then 'expired' when status='sent' then 'pending' else status end,'expiresAt',expires_at)) from private.cleaner_invitations where property_id=p.id),'[]'),
'jobs',coalesce((select jsonb_agg(private.job_dto(j.id)||jsonb_build_object('assignments',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'cleanerId',a.cleaner_id,'name',u3.display_name,'displayName',u3.display_name,'agreedPayCents',a.agreed_pay_cents,'needsResolution',a.needs_resolution)),'[]') from public.assignments a join public.users u3 on u3.id=a.cleaner_id where a.job_id=j.id and a.ended_at is null))) from (select * from public.jobs where property_id=p.id and status='open' order by checkout_date limit 100) j),'[]'));end$$;
create function public.bloom_property_team_action(p_property uuid,p_action text,p_data jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$declare u public.users;p public.properties;r jsonb;x jsonb;input jsonb:=jsonb_build_object('property',p_property,'action',p_action,'data',p_data);begin u:=private.require_actor();select * into p from public.properties where id=p_property for update;if not private.people_access(p_property,u.id) then raise exception 'NOT_FOUND';end if;r:=private.receipt('property_team',p_key,input);if r is not null then return r;end if;if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'VALIDATION_ERROR';end if;
if p_action='host_charge' then if u.role<>'admin' then raise exception 'FORBIDDEN';end if;if (p_data->>'amountCents')::integer not between 0 and 100000000 then raise exception 'VALIDATION_ERROR';end if;update public.properties set bloom_host_charge_cents=(p_data->>'amountCents')::integer where id=p.id;
elsif p_action='settings' then if (p_data->>'capacity')::integer not between 1 and 20 or (p_data->>'totalCents')::integer not between 20 and 100000000 then raise exception 'VALIDATION_ERROR';end if;if (select count(*) from private.property_cleaner_members where property_id=p.id and active and default_assigned)>(p_data->>'capacity')::integer then raise exception 'CONFLICT';end if;update public.properties set private_capacity=(p_data->>'capacity')::integer,private_total_cents=(p_data->>'totalCents')::integer,private_payer_id=coalesce(private_payer_id,case when u.role='owner' then u.id else (select owner_id from public.property_owners where property_id=p.id order by owner_id limit 1) end) where id=p.id;
elsif p_action='defaults' then if jsonb_typeof(p_data->'cleaners') is distinct from 'array' or jsonb_array_length(p_data->'cleaners')>p.private_capacity then raise exception 'VALIDATION_ERROR';end if;if exists(select 1 from jsonb_array_elements(p_data->'cleaners') x group by x->>'cleanerId' having count(*)>1) then raise exception 'VALIDATION_ERROR';end if;if exists(select 1 from jsonb_array_elements(p_data->'cleaners') x where x->>'individualAmountCents' is not null) and exists(select 1 from jsonb_array_elements(p_data->'cleaners') x where x->>'individualAmountCents' is null) then raise exception 'VALIDATION_ERROR';end if;update private.property_cleaner_members set default_assigned=false where property_id=p.id;for x in select value from jsonb_array_elements(p_data->'cleaners') loop if not private.team_member(p.id,(x->>'cleanerId')::uuid) then raise exception 'NOT_FOUND';end if;update private.property_cleaner_members set default_assigned=true,individual_amount_cents=(x->>'individualAmountCents')::integer where property_id=p.id and cleaner_id=(x->>'cleanerId')::uuid;end loop;
elsif p_action='request_bloom' then if (p_data->>'enabled')::boolean then update public.properties set cleaning_management=case when bloom_approved and exists(select 1 from public.cities where id=p.city_id and active) then 'bloom' else cleaning_management end,bloom_request_status=case when bloom_approved and exists(select 1 from public.cities where id=p.city_id and active) then 'accepted' else 'pending' end where id=p.id;else if p.is_bloom_owned then raise exception 'INVALID_STATE';end if;update public.properties set cleaning_management='private',bloom_request_status='none',private_payer_id=coalesce(private_payer_id,case when u.role='owner' then u.id else (select owner_id from public.property_owners where property_id=p.id order by owner_id limit 1) end) where id=p.id;end if;
elsif p_action='approve_bloom' then if u.role<>'admin' then raise exception 'FORBIDDEN';end if;if (p_data->>'approved')::boolean and not exists(select 1 from public.cities where id=p.city_id and active) then raise exception 'CITY_MISMATCH';end if;update public.properties set bloom_approved=(p_data->>'approved')::boolean,cleaning_management=case when (p_data->>'approved')::boolean then 'bloom' else cleaning_management end,bloom_request_status=case when (p_data->>'approved')::boolean then 'accepted' else 'unavailable' end where id=p.id;perform private.team_notice(p.id,null,'Bloom cleaning request has been reviewed.');
elsif p_action='remove' then update private.property_cleaner_members set active=false,default_assigned=false where property_id=p.id and cleaner_id=(p_data->>'cleanerId')::uuid;update public.assignments a set needs_resolution=true where cleaner_id=(p_data->>'cleanerId')::uuid and ended_at is null and exists(select 1 from public.jobs j where j.id=a.job_id and j.property_id=p.id and j.status='open');perform private.team_notice(p.id,null,'Team member removed. Review their outstanding assignments.');
elsif p_action='revoke' then update private.cleaner_invitations set status='revoked' where id=(p_data->>'invitationId')::uuid and property_id=p.id and status in ('pending','sent');if not found then raise exception 'NOT_FOUND';end if;
else raise exception 'VALIDATION_ERROR';end if;return private.save_receipt('property_team',p_key,input,public.bloom_property_team(p.id));end$$;
create function public.bloom_private_job_action(p_job uuid,p_action text,p_data jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$declare u public.users;j public.jobs;r jsonb;b jsonb;s integer;a public.assignments;input jsonb:=jsonb_build_object('job',p_job,'action',p_action,'data',p_data);begin u:=private.require_actor();perform 1 from public.properties where id=(select property_id from public.jobs where id=p_job) for update;select * into j from public.jobs where id=p_job for update;if not private.people_access(j.property_id,u.id) then raise exception 'NOT_FOUND';end if;r:=private.receipt('private_job',p_key,input);if r is not null then return r;end if;if j.status<>'open' or j.cleaning_management<>'private' then raise exception 'INVALID_STATE';end if;b:=private.job_snapshot(j.id);
if p_action='assign' then if not private.team_member(j.property_id,(p_data->>'cleanerId')::uuid) or not exists(select 1 from public.users where id=(p_data->>'cleanerId')::uuid and role='cleaner' and onboarding_completed_at is not null) then raise exception 'NOT_FOUND';end if;if p_data->>'removeAssignmentId' is not null then if coalesce(length(trim(p_data->>'reason')),0)=0 then raise exception 'VALIDATION_ERROR';end if;update public.assignments set ended_at=now(),end_reason='reassigned' where id=(p_data->>'removeAssignmentId')::uuid and job_id=j.id and ended_at is null;if not found then raise exception 'NOT_FOUND';end if;end if;if exists(select 1 from public.assignments where job_id=j.id and cleaner_id=(p_data->>'cleanerId')::uuid and ended_at is null) then raise exception 'ALREADY_ASSIGNED';end if;select n into s from generate_series(1,j.staffing_capacity) n where not exists(select 1 from public.assignments where job_id=j.id and slot=n and ended_at is null) order by n limit 1;if s is null then raise exception 'JOB_FULL';end if;if j.compensation_mode='equal' and p_data->>'individualAmountCents' is not null then raise exception 'VALIDATION_ERROR';end if;if j.compensation_mode='individual' and p_data->>'individualAmountCents' is null then raise exception 'VALIDATION_ERROR';end if;insert into public.assignments(job_id,cleaner_id,slot,agreed_pay_cents) values(j.id,(p_data->>'cleanerId')::uuid,s,(p_data->>'individualAmountCents')::integer);perform private.team_notice(j.property_id,j.id,'You have been assigned a private cleaning.',(p_data->>'cleanerId')::uuid);
elsif p_action='remove_assignment' then if coalesce(length(trim(p_data->>'reason')),0) not between 1 and 1000 then raise exception 'VALIDATION_ERROR';end if;update public.assignments set ended_at=now(),end_reason='reassigned',withdrawal_comment=p_data->>'reason' where id=(p_data->>'assignmentId')::uuid and job_id=j.id and ended_at is null;if not found then raise exception 'NOT_FOUND';end if;
elsif p_action='set_compensation' then if coalesce(length(trim(p_data->>'reason')),0) not between 1 and 1000 or (p_data->>'amountCents')::integer not between 1 and 100000000 then raise exception 'VALIDATION_ERROR';end if;if j.compensation_mode<>'individual' then raise exception 'INVALID_STATE';end if;update public.assignments set agreed_pay_cents=(p_data->>'amountCents')::integer where id=(p_data->>'assignmentId')::uuid and job_id=j.id and ended_at is null;if not found then raise exception 'NOT_FOUND';end if;
elsif p_action='request_bloom' then update public.jobs set bloom_coverage_requested=true where id=j.id;
elsif p_action='approve_bloom' then if u.role<>'admin' then raise exception 'FORBIDDEN';end if;if coalesce(length(trim(p_data->>'reason')),0)=0 or not j.bloom_coverage_requested then raise exception 'VALIDATION_ERROR';end if;if exists(select 1 from public.assignments where job_id=j.id and ended_at is null) then raise exception 'CONFLICT';end if;if not exists(select 1 from public.properties p join public.cities c on c.id=p.city_id where p.id=j.property_id and c.active) then raise exception 'CITY_MISMATCH';end if;update public.jobs set cleaning_management='bloom',payer_owner_id=null,staffing_capacity=2,compensation_mode='equal',bloom_coverage_requested=false,host_charge_cents_snapshot=(select bloom_host_charge_cents from public.properties where id=j.property_id) where id=j.id;perform private.team_notice(j.property_id,j.id,'Bloom Cleaning will manage this cleaning.');
else raise exception 'VALIDATION_ERROR';end if;update public.jobs set version=version+1 where id=j.id;perform private.audit(j.id,'private_'||p_action,b,p_key,p_data);return private.save_receipt('private_job',p_key,input,private.job_dto(j.id));end$$;
create function public.bloom_team_invite(p_property uuid,p_email text,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;i private.cleaner_invitations;r jsonb;input jsonb;begin
 u:=private.require_actor();perform 1 from public.properties where id=p_property for update;
 if not private.people_access(p_property,u.id) then raise exception 'NOT_FOUND';end if;
 if p_email is null or length(p_email)>254 or p_email<>lower(btrim(p_email)) or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'VALIDATION_ERROR';end if;
 input:=jsonb_build_object('propertyId',p_property,'email',p_email);
 r:=private.receipt('team_invite',p_key,input);
 if r is not null then return r;end if;
 if exists(select 1 from private.cleaner_invitations old join private.property_cleaner_members m on m.property_id=old.property_id and m.cleaner_id=old.accepted_by where old.property_id=p_property and old.email=p_email and old.status='accepted' and m.active) then raise exception 'ALREADY_ASSIGNED';end if;
 update private.cleaner_invitations set status='expired' where property_id=p_property and email=p_email and status in ('pending','sent') and expires_at<=clock_timestamp();
 select * into i from private.cleaner_invitations where property_id=p_property and email=p_email and status in ('pending','sent');
 if i.id is null then insert into private.cleaner_invitations(property_id,actor_id,email) values(p_property,u.id,p_email) returning * into i;end if;
 return private.save_receipt('team_invite',p_key,input,jsonb_build_object('id',i.id));
end $$;
create function public.bloom_team_invite_delivery(p_actor uuid,p_id uuid,p_lease uuid default null,p_delivery text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.cleaner_invitations;pid uuid;begin
 perform private.people_service();select property_id into pid from private.cleaner_invitations where id=p_id;
 perform 1 from public.properties where id=pid for update;
 select * into i from private.cleaner_invitations where id=p_id for update;
 if i.id is null or not private.people_access(i.property_id,p_actor) or not private.people_access(i.property_id,i.actor_id) then raise exception 'NOT_FOUND';end if;
 if i.status not in ('pending','sent') then raise exception 'INVALID_STATE';end if;
 if i.expires_at<=clock_timestamp() then raise exception 'INVALID_STATE';end if;
 if p_lease is not null then
  if i.delivery_lease is distinct from p_lease or p_delivery is null or length(p_delivery)>200 then raise exception 'CONFLICT';end if;
  update private.cleaner_invitations set status='sent',delivery_id=p_delivery,lease_until=null where id=i.id returning * into i;
 elsif i.status='pending' then
  if i.lease_until>clock_timestamp() then raise exception 'CONFLICT';end if;
  update private.cleaner_invitations set delivery_lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes' where id=i.id returning * into i;
 end if;
 return jsonb_build_object('id',i.id,'email',i.email,'status',i.status,'expiresAt',i.expires_at,'lease',case when i.status='pending' then i.delivery_lease end);
end $$;
create function public.bloom_team_invites_incoming(p_emails text[]) returns jsonb language plpgsql security definer set search_path='' as $$begin perform private.people_service();if p_emails is null or cardinality(p_emails)>100 then raise exception 'VALIDATION_ERROR';end if;return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'propertyId',i.property_id,'propertyName',p.name,'status',case when i.status='revoked' or not private.people_access(i.property_id,i.actor_id) then 'revoked' when i.status in ('pending','sent') and i.expires_at<=now() then 'expired' when i.status='sent' then 'pending' else i.status end,'expiresAt',i.expires_at)) from private.cleaner_invitations i join public.properties p on p.id=i.property_id where i.email=any(p_emails)),'[]'));end$$;
create function public.bloom_team_invite_accept(p_id uuid,p_subject text,p_emails text[],p_name text,p_network boolean default false,p_city uuid default null,p_complete boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$declare i private.cleaner_invitations;u public.users;begin perform private.people_service();if coalesce(length(p_subject),0) not between 1 and 200 or coalesce(length(trim(p_name)),0) not between 1 and 100 or p_emails is null or cardinality(p_emails)>100 or p_network is null or p_complete is null then raise exception 'VALIDATION_ERROR';end if;perform 1 from public.properties where id=(select property_id from private.cleaner_invitations where id=p_id) for update;select * into i from private.cleaner_invitations where id=p_id for update;if i.id is null or not coalesce(i.email=any(p_emails),false) or not private.people_access(i.property_id,i.actor_id) then raise exception 'NOT_FOUND';end if;if i.status not in ('sent','accepted') or (i.status<>'accepted' and i.expires_at<=now()) then raise exception 'INVALID_STATE';end if;perform pg_advisory_xact_lock(hashtextextended('onboard:'||p_subject,0));select * into u from public.users where clerk_user_id=p_subject for update;if u.id is not null and u.role<>'cleaner' then raise exception 'FORBIDDEN';end if;if i.status='accepted' and i.accepted_by is distinct from u.id then raise exception 'NOT_FOUND';end if;if u.id is null then insert into public.users(clerk_user_id,role,display_name,bloom_network_enabled) values(p_subject,'cleaner',trim(p_name),false) returning * into u;end if;if p_complete and u.onboarding_completed_at is null then if p_network then if p_city is null or not exists(select 1 from public.cities where id=p_city and active) then raise exception 'VALIDATION_ERROR';end if;if u.initial_city_selected_at is not null and u.approved_city_id is distinct from p_city then raise exception 'CONFLICT';end if;end if;update public.users set onboarding_completed_at=now(),bloom_network_enabled=p_network,approved_city_id=case when p_network then p_city else approved_city_id end,initial_city_selected_at=case when p_network then coalesce(initial_city_selected_at,now()) else initial_city_selected_at end where id=u.id;end if;if i.status<>'accepted' then insert into private.property_cleaner_members(property_id,cleaner_id) values(i.property_id,u.id) on conflict(property_id,cleaner_id) do update set active=true;update private.cleaner_invitations set status='accepted',accepted_by=u.id,accepted_at=now() where id=i.id;perform private.team_notice(i.property_id,null,'A cleaner accepted your property invitation.');end if;return jsonb_build_object('propertyId',i.property_id,'role','cleaner','status',case when (select onboarding_completed_at is not null from public.users where id=u.id) then 'complete' else 'incomplete' end,'destination','/cleaner');end$$;
create function public.bloom_property_team_jobs(p_property uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin return public.bloom_property_team(p_property)->'jobs';end$$;
-- Grant only the intended entrypoints; helpers and team tables never accept direct browser writes.
revoke all on private.property_cleaner_members,private.team_notices,private.cleaner_invitations from public,anon,authenticated,service_role;
revoke all on function private.team_member(uuid,uuid),private.team_notice(uuid,uuid,text,uuid),private.initial_management(),private.snapshot_management(),private.autoassign_private(),private.job_dto_before_teams(uuid) from public,anon,authenticated,service_role;
revoke all on function private.job_visible(uuid) from public,anon;grant execute on function private.job_visible(uuid) to authenticated;
revoke all on function public.bloom_property_team(uuid),public.bloom_property_team_jobs(uuid),public.bloom_property_team_action(uuid,text,jsonb,text),public.bloom_private_job_action(uuid,text,jsonb,text),public.bloom_team_invite(uuid,text,text),public.bloom_cleaner_network(boolean,uuid,text) from public,anon,service_role;
grant execute on function public.bloom_property_team(uuid),public.bloom_property_team_jobs(uuid),public.bloom_property_team_action(uuid,text,jsonb,text),public.bloom_private_job_action(uuid,text,jsonb,text),public.bloom_team_invite(uuid,text,text),public.bloom_cleaner_network(boolean,uuid,text) to authenticated;
revoke all on function public.bloom_team_invites_incoming(text[]),public.bloom_team_invite_delivery(uuid,uuid,uuid,text),public.bloom_team_invite_accept(uuid,text,text[],text,boolean,uuid,boolean) from public,anon,authenticated;
grant execute on function public.bloom_team_invites_incoming(text[]),public.bloom_team_invite_delivery(uuid,uuid,uuid,text),public.bloom_team_invite_accept(uuid,text,text[],text,boolean,uuid,boolean) to service_role;
-- Enforce membership/capacity even when another privileged operation inserts an assignment.
create function private.guard_private_assignment() returns trigger language plpgsql security definer set search_path='' as $$declare j public.jobs;begin select * into j from public.jobs where id=new.job_id for update;if new.slot>j.staffing_capacity then raise exception 'JOB_FULL';end if;if TG_OP='INSERT' and j.cleaning_management='private' and not private.team_member(j.property_id,new.cleaner_id) then raise exception 'FORBIDDEN';end if;return new;end$$;
create trigger private_assignment_guard before insert or update on public.assignments for each row execute function private.guard_private_assignment();
revoke all on function private.guard_private_assignment() from public,anon,authenticated,service_role;

create function public.bloom_team_onboard(p_ids uuid[],p_subject text,p_emails text[],p_name text,p_network boolean,p_city uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$declare i uuid;r jsonb;begin perform private.people_service();if coalesce(cardinality(p_ids),0) not between 1 and 100 then raise exception 'VALIDATION_ERROR';end if;foreach i in array p_ids loop r:=public.bloom_team_invite_accept(i,p_subject,p_emails,p_name,p_network,p_city,false);end loop;r:=public.bloom_team_invite_accept(p_ids[1],p_subject,p_emails,p_name,p_network,p_city,true);return jsonb_build_object('status','complete','role','cleaner','destination','/cleaner');end$$;
revoke all on function public.bloom_team_onboard(uuid[],text,text[],text,boolean,uuid) from public,anon,authenticated;grant execute on function public.bloom_team_onboard(uuid[],text,text[],text,boolean,uuid) to service_role;
revoke all on function private.job_dto(uuid) from public,anon,authenticated,service_role;

alter function public.bloom_onboarding_profile() rename to bloom_onboarding_profile_before_teams;
revoke all on function public.bloom_onboarding_profile_before_teams() from public,anon,authenticated,service_role;
create function public.bloom_onboarding_profile() returns jsonb language plpgsql stable security definer set search_path='' as $$declare r jsonb;begin r:=public.bloom_onboarding_profile_before_teams();if r is null then return null;end if;return r||jsonb_build_object('bloomNetworkEnabled',(select bloom_network_enabled from public.users where clerk_user_id=auth.jwt()->>'sub'));end$$;
revoke all on function public.bloom_onboarding_profile() from public,anon,service_role;grant execute on function public.bloom_onboarding_profile() to authenticated;
create or replace function public.bloom_push_tick(p_now timestamptz default now()) returns integer language plpgsql security definer set search_path='' as $$
declare c record; scheduled_at timestamptz; local_day date; k text; n integer;begin
 perform pg_advisory_xact_lock(hashtextextended('bloom-push-tick',0));
 if (select activated_at is null from private.push_control) then return 0;end if;
 insert into private.push_messages(logical_key,user_id,kind,city_id,job_ids,expires_at)
 select 'new:'||b.batch||':'||b.city_id||':'||u.id,u.id,'new',b.city_id,b.ids,p_now+interval '1 hour'
 from (select batch,city_id,array_agg(job_id) ids from private.push_publications where not consumed and published_at>=p_now-interval '1 hour' group by batch,city_id) b
 join public.users u on u.role='cleaner' and u.bloom_network_enabled and u.approved_city_id=b.city_id join private.push_preferences s on s.user_id=u.id and s.new_jobs
 on conflict do nothing;
 update private.push_publications set consumed=true where not consumed;
 for c in select * from public.cities where notification_timezone is not null loop
  local_day:=(p_now at time zone c.notification_timezone)::date;
  foreach k in array array['evening','morning'] loop
   scheduled_at:=(local_day+case when k='evening' then time '18:00' else time '08:00' end) at time zone c.notification_timezone;
   if p_now>=scheduled_at and p_now<scheduled_at+interval '10 minutes' then
    insert into private.push_messages(logical_key,user_id,kind,city_id,job_date,cutoff,expires_at)
    select k||':'||c.id||':'||local_day||':'||u.id,u.id,k,c.id,local_day+case when k='evening' then 1 else 0 end,scheduled_at,scheduled_at+interval '10 minutes'
    from public.users u join private.push_preferences s on s.user_id=u.id and s.reminders where u.role='cleaner' and exists(
     select 1 from public.assignments a join public.jobs j on j.id=a.job_id join public.properties p on p.id=j.property_id
     where a.cleaner_id=u.id and a.ended_at is null and a.claimed_at<=scheduled_at and p.city_id=c.id and j.status='open' and j.checkout_date=local_day+case when k='evening' then 1 else 0 end)
    on conflict do nothing;
   end if;
  end loop;
 end loop;
 insert into private.push_deliveries(message_id,device_id,generation)
 select m.id,d.id,d.generation from private.push_messages m join private.push_devices d on d.user_id=m.user_id and d.verified
 where m.kind<>'test' and m.expires_at>p_now and d.updated_at<=m.created_at and private.push_content(m.id,p_now) is not null on conflict do nothing;
 get diagnostics n=row_count;return n;
end $$;
commit;
