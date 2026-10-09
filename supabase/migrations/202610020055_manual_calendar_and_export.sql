begin;
-- Main integration owns 055. Manual bookings are never members of an imported feed.
alter table public.properties add column default_checkin_time time not null default '15:00',add column default_checkout_time time not null default '11:00',add column cleaning_start_time time not null default '11:00',add column cleaning_end_time time not null default '15:00',add check(cleaning_end_time>cleaning_start_time);
create table private.manual_bookings(
 id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties,
 check_in date not null,checkout date not null,internal_note text not null default '',status text not null default 'active' check(status in ('active','cancelled')),
 checkin_time time not null,checkout_time time not null,timezone text not null,
 created_by uuid not null references public.users,version integer not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(isfinite(check_in) and isfinite(checkout) and checkout>check_in),check(length(internal_note)<=2000)
);
create index manual_booking_availability on private.manual_bookings(property_id,check_in,checkout) where status='active';
create table private.manual_booking_history(id uuid primary key default gen_random_uuid(),booking_id uuid not null references private.manual_bookings,actor_id uuid not null references public.users,before_snapshot jsonb,after_snapshot jsonb,request_id text not null,created_at timestamptz not null default now());
create trigger manual_booking_history_immutable before update or delete on private.manual_booking_history for each row execute function private.immutable();
alter table public.jobs add column creation_origin text not null default 'imported' check(creation_origin in ('imported','manual_cleaning','manual_booking')),add column manual_booking_id uuid references private.manual_bookings,add column manual_date_override boolean not null default false,add column manual_config jsonb,add column job_instructions text not null default '' check(length(job_instructions)<=4000);
alter table public.jobs drop constraint jobs_property_id_checkout_date_key;
create unique index one_imported_turnover on public.jobs(property_id,checkout_date) where creation_origin='imported' and not manual_date_override;
create unique index one_manual_checkout on public.jobs(manual_booking_id) where creation_origin='manual_booking';
create table private.calendar_returns(event_id uuid primary key references public.calendar_events,booking_id uuid not null references private.manual_bookings,state text not null check(state in ('ambiguous','confirmed','unrelated')),event_version bigint not null,booking_version integer not null,reviewed_by uuid references public.users,reviewed_at timestamptz);
create table private.calendar_exports(property_id uuid primary key references public.properties,token text not null,token_hash text not null unique,enabled boolean not null default true,last_fetched_at timestamptz,owner_confirmed_at timestamptz,updated_at timestamptz not null default now());
revoke all on private.manual_bookings,private.manual_booking_history,private.calendar_returns,private.calendar_exports from public,anon,authenticated,service_role;

create function private.manual_property(p_property uuid) returns public.properties language plpgsql security definer set search_path='' as $$
declare u public.users;p public.properties;begin
 u:=private.require_actor();select * into p from public.properties where id=p_property for update;
 if p.id is null or p.deleted_at is not null or not private.people_access(p.id,u.id) then raise exception 'NOT_FOUND';end if;
 if not p.active then raise exception 'INVALID_STATE';end if;return p;
end$$;
create function private.manual_conflict(p_code text,p_message text,p_details jsonb default '{}') returns jsonb language sql immutable set search_path='' as $$select jsonb_build_object('ok',false,'conflict',jsonb_build_object('code',p_code,'message',p_message,'details',p_details))$$;
create function private.manual_window(p_date date,p_start time,p_end time,p_timezone text) returns tstzrange language plpgsql stable set search_path='' as $$
declare a timestamptz;b timestamptz;begin
 if p_date is null or not isfinite(p_date) or p_start is null or p_end is null or p_end<=p_start then raise exception 'VALIDATION_ERROR';end if;
 a:=(p_date+p_start) at time zone p_timezone;b:=(p_date+p_end) at time zone p_timezone;
 if a at time zone p_timezone<>p_date+p_start or b at time zone p_timezone<>p_date+p_end or b<=a then raise exception 'VALIDATION_ERROR';end if;
 return tstzrange(a,b,'[)');
end$$;
create or replace function private.guard_job() returns trigger language plpgsql set search_path='' as $$begin
 if TG_OP='DELETE' then raise exception 'INVALID_STATE';end if;
 if TG_OP='UPDATE' and old.status='completed' and new is distinct from old then raise exception 'INVALID_STATE';end if;
 if not exists(select 1 from pg_timezone_names where name=new.timezone_snapshot) then raise exception 'VALIDATION_ERROR';end if;
 if new.creation_origin<>'imported' or new.manual_date_override then
  if (new.start_at at time zone new.timezone_snapshot)::date<>new.checkout_date or (new.end_at at time zone new.timezone_snapshot)::date<>new.checkout_date or new.end_at<=new.start_at then raise exception 'VALIDATION_ERROR';end if;
 elsif new.start_at is distinct from ((new.checkout_date+time '11:00') at time zone new.timezone_snapshot) or new.end_at is distinct from ((new.checkout_date+time '15:00') at time zone new.timezone_snapshot) then
  if not exists(select 1 from private.practice_window_exceptions e where e.job_id=new.id and e.property_id=new.property_id and e.start_at=new.start_at and e.end_at=new.end_at) then raise exception 'VALIDATION_ERROR';end if;
 end if;return new;
end$$;
-- Existing pipeline still owns immutable property/config snapshots and private staffing.
do $$declare definition text;begin
 definition:=pg_get_functiondef('private.snapshot_management()'::regprocedure);
 definition:=replace(definition,'begin select * into p', 'begin if new.manual_config is not null then new.cleaning_management:=new.manual_config->>''management'';new.payer_owner_id:=(new.manual_config->>''payerId'')::uuid;new.staffing_capacity:=(new.manual_config->>''capacity'')::integer;new.private_total_cents_snapshot:=(new.manual_config->>''totalCents'')::integer;new.compensation_mode:=new.manual_config->>''compensationMode'';new.bloom_coverage_requested:=(new.manual_config->>''requested'')::boolean;new.host_charge_cents_snapshot:=(new.manual_config->>''hostChargeCents'')::integer;return new;end if;select * into p');
 execute definition;
end$$;
create or replace function private.autoassign_private() returns trigger language plpgsql security definer set search_path='' as $$
declare m record;s integer:=0;begin
 if new.cleaning_management<>'private' or new.setup_required or new.status<>'open' then return new;end if;
 if TG_OP='UPDATE' and not old.setup_required then return new;end if;
 for m in select t.cleaner_id,case when new.manual_config is null then t.individual_amount_cents else (x.value->>'amountCents')::integer end individual_amount_cents
 from private.property_cleaner_members t join public.users u on u.id=t.cleaner_id
 left join lateral jsonb_array_elements(coalesce(new.manual_config->'cleaners','[]')) x on (x.value->>'cleanerId')::uuid=t.cleaner_id
 where t.property_id=new.property_id and t.active and u.role='cleaner' and u.onboarding_completed_at is not null
 and ((new.manual_config is null and t.default_assigned) or x.value is not null)
 and (new.compensation_mode='equal' or coalesce((x.value->>'amountCents')::integer,t.individual_amount_cents) is not null)
 and not exists(select 1 from public.assignments a join public.jobs j on j.id=a.job_id where a.cleaner_id=t.cleaner_id and a.ended_at is null and j.status='open' and j.id<>new.id and tstzrange(j.start_at,j.end_at,'[)')&&tstzrange(new.start_at,new.end_at,'[)'))
 order by t.cleaner_id limit new.staffing_capacity loop
 s:=s+1;insert into public.assignments(job_id,cleaner_id,slot,agreed_pay_cents) values(new.id,m.cleaner_id,s,case when new.compensation_mode='individual' then m.individual_amount_cents else null end);
 perform private.team_notice(new.property_id,new.id,'You have been assigned a private cleaning.',m.cleaner_id);
 end loop;
 if s<new.staffing_capacity then perform private.team_notice(new.property_id,new.id,'Your cleaning needs additional team members. Review unavailable or insufficient defaults.');end if;return new;
end$$;

create function private.manual_preview(p_property uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.properties;day date;lo date;hi date;r jsonb;w tstzrange;begin
 p:=private.manual_property(p_property);day:=coalesce((p_data->>'date')::date,(p_data->>'checkout')::date);lo:=coalesce((p_data->>'checkIn')::date,day);hi:=coalesce((p_data->>'checkout')::date,day+1);
 if day is null or not isfinite(day) or not isfinite(lo) or not isfinite(hi) or hi<lo or hi-lo>1830 then raise exception 'VALIDATION_ERROR';end if;
 w:=private.manual_window(day,coalesce((p_data->>'startTime')::time,p.cleaning_start_time),coalesce((p_data->>'endTime')::time,p.cleaning_end_time),p.timezone);
 r:=jsonb_build_object('propertyId',p.id,'date',day,'timezone',p.timezone,'startAt',lower(w),'endAt',upper(w),
 'defaults',jsonb_build_object('management',p.cleaning_management,'bloomApproved',p.bloom_approved,'serviceAvailable',(select active from public.cities where id=p.city_id),'startTime',p.cleaning_start_time,'endTime',p.cleaning_end_time,'checkInTime',p.default_checkin_time,'checkoutTime',p.default_checkout_time,'soloRateCents',p.solo_rate_cents,'hostChargeCents',p.bloom_host_charge_cents,'capacity',p.private_capacity,'totalCents',p.private_total_cents,'payerOwnerId',coalesce(p.private_payer_id,(select owner_id from public.property_owners where property_id=p.id order by owner_id limit 1)),
 'cleaners',(select coalesce(jsonb_agg(jsonb_build_object('cleanerId',m.cleaner_id,'name',u.display_name,'defaultAssigned',m.default_assigned,'amountCents',m.individual_amount_cents,'unavailable',u.onboarding_completed_at is null or exists(select 1 from public.assignments a join public.jobs j on j.id=a.job_id where a.cleaner_id=u.id and a.ended_at is null and j.status='open' and tstzrange(j.start_at,j.end_at,'[)')&&w)) order by m.cleaner_id),'[]') from private.property_cleaner_members m join public.users u on u.id=m.cleaner_id where m.property_id=p.id and m.active)),
 'stays',(select coalesce(jsonb_agg(v order by v->>'startDate',v->>'id'),'[]') from (
 select jsonb_build_object('id',e.id,'source',s.provider,'startDate',e.start_local_date,'endDate',e.end_local_date,'kind',e.kind,'reason',case when e.missing_reason is not null then 'UNCONFIRMED_REMOVAL' when e.review_required then 'UNRESOLVED_SOURCE' when e.kind='blocked' then 'BLOCKED' when e.kind='unknown' then 'UNCONFIRMED' else 'OCCUPIED' end,'version',e.transition_version,'inStay',case when e.end_local_date>e.start_local_date then tstzrange((e.start_local_date+p.default_checkin_time) at time zone p.timezone,(e.end_local_date+p.default_checkout_time) at time zone p.timezone,'[)')&&w else false end) v
 from public.calendar_events e join public.calendar_sources s on s.id=e.source_id where s.property_id=p.id and (e.source_status='active' or e.missing_reason is not null) and e.start_local_date<=greatest(day,hi) and e.end_local_date>=least(day,lo)
 union all select jsonb_build_object('id',b.id,'source','manual','startDate',b.check_in,'endDate',b.checkout,'kind','reservation','reason','OCCUPIED','version',b.version,'inStay',tstzrange((b.check_in+b.checkin_time) at time zone b.timezone,(b.checkout+b.checkout_time) at time zone b.timezone,'[)')&&w) from private.manual_bookings b where b.property_id=p.id and b.status='active' and b.check_in<=greatest(day,hi) and b.checkout>=least(day,lo)) v),
 'jobs',(select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'date',j.checkout_date,'version',j.version,'status',j.status,'startedAt',j.started_at,'management',j.cleaning_management,'payerOwnerId',j.payer_owner_id,'bookingId',j.manual_booking_id,'eventIds',(select coalesce(jsonb_agg(event_id),'[]') from public.job_events where job_id=j.id),'canMove',j.status='open' and j.started_at is null and j.start_at>now(),'assignments',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'cleanerId',a.cleaner_id,'amountCents',a.agreed_pay_cents) order by a.id),'[]') from public.assignments a where a.job_id=j.id and a.ended_at is null)) order by j.id),'[]') from public.jobs j where j.property_id=p.id and (j.checkout_date=day or j.manual_booking_id in(select id from private.manual_bookings where property_id=p.id and check_in<=greatest(day,hi) and checkout>=least(day,lo)) or exists(select 1 from public.job_events je join public.calendar_events e on e.id=je.event_id where je.job_id=j.id and e.start_local_date<=greatest(day,hi) and e.end_local_date>=least(day,lo)))));
 return r||jsonb_build_object('reviewToken',private.calendar_hash(r));
end$$;
create function private.manual_create_job(p_property uuid,p_day date,p_data jsonb,p_origin text,p_booking uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.properties;u public.users;management text;requested boolean;w tstzrange;cfg jsonb;members jsonb;capacity integer;total integer;rate integer;payer uuid;mode text;created_job_id uuid;begin
 p:=private.manual_property(p_property);u:=private.require_actor();
 requested:=coalesce((p_data->>'bloomManaged')::boolean,p.cleaning_management='bloom');
 management:=case when requested and p.bloom_approved and exists(select 1 from public.cities where id=p.city_id and active) then 'bloom' else 'private' end;
 if p_data ? 'soloRateCents' and u.role<>'admin' then raise exception 'FORBIDDEN';end if;
 rate:=coalesce((p_data->>'soloRateCents')::integer,p.solo_rate_cents);
 if rate not between 2 and 100000000 or rate%2<>0 then raise exception 'VALIDATION_ERROR';end if;
 w:=private.manual_window(p_day,coalesce((p_data->>'startTime')::time,p.cleaning_start_time),coalesce((p_data->>'endTime')::time,p.cleaning_end_time),p.timezone);
 if upper(w)<=now() then raise exception 'INVALID_STATE';end if;
 if management='bloom' then
  if p_data ?| array['capacity','totalCents','cleaners','payerOwnerId'] then raise exception 'VALIDATION_ERROR';end if;
  capacity:=2;mode:='equal';members:='[]';
 else
  capacity:=coalesce((p_data->>'capacity')::integer,p.private_capacity);total:=coalesce((p_data->>'totalCents')::integer,p.private_total_cents);
  if capacity not between 1 and 20 or total not between 20 and 100000000 then raise exception 'VALIDATION_ERROR';end if;
  payer:=coalesce((p_data->>'payerOwnerId')::uuid,p.private_payer_id,(select owner_id from public.property_owners where property_id=p.id order by owner_id limit 1));
  if payer is null or not exists(select 1 from public.property_owners where property_id=p.id and owner_id=payer) then raise exception 'VALIDATION_ERROR';end if;
  members:=coalesce(p_data->'cleaners',(select coalesce(jsonb_agg(jsonb_build_object('cleanerId',cleaner_id,'amountCents',individual_amount_cents) order by cleaner_id),'[]') from private.property_cleaner_members where property_id=p.id and active and default_assigned));
  if jsonb_typeof(members)<>'array' or jsonb_array_length(members)>capacity then raise exception 'VALIDATION_ERROR';end if;
  if exists(select 1 from jsonb_array_elements(members) x where not private.team_member(p.id,(x->>'cleanerId')::uuid) or (x->>'amountCents' is not null and (x->>'amountCents')::integer not between 1 and 100000000)) or exists(select 1 from jsonb_array_elements(members) x group by x->>'cleanerId' having count(*)>1) then raise exception 'VALIDATION_ERROR';end if;
  if exists(select 1 from jsonb_array_elements(members) x where x->>'amountCents' is not null) and exists(select 1 from jsonb_array_elements(members) x where x->>'amountCents' is null) then raise exception 'VALIDATION_ERROR';end if;
  mode:=case when exists(select 1 from jsonb_array_elements(members) x where x->>'amountCents' is not null) then 'individual' else 'equal' end;
 end if;
 cfg:=jsonb_build_object('management',management,'payerId',payer,'capacity',capacity,'totalCents',total,'compensationMode',mode,'cleaners',members,'requested',requested and management='private','hostChargeCents',case when management='bloom' then p.bloom_host_charge_cents end);
 insert into public.jobs(property_id,checkout_date,start_at,end_at,timezone_snapshot,solo_rate_cents_snapshot,creation_origin,manual_booking_id,manual_config,job_instructions)
 values(p.id,p_day,lower(w),upper(w),p.timezone,rate,p_origin,p_booking,cfg,coalesce(p_data->>'instructions','')) returning jobs.id into created_job_id;
 if requested and management='private' then
  perform private.team_notice(p.id,created_job_id,'Bloom cleaning requested. This cleaning remains with your private team until accepted.');
  insert into private.team_notices(user_id,property_id,job_id,body) select users.id,p.id,created_job_id,'Bloom coverage requested for a cleaning.' from public.users where role='admin';
 end if;
 return created_job_id;
end$$;
create function private.manual_move_job(p_job uuid,p_date date,p_start time,p_end time,p_key text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare j public.jobs;b jsonb;w tstzrange;a record;begin
 select * into j from public.jobs where id=p_job for update;
 if j.status<>'open' or j.started_at is not null or j.start_at<=now() then raise exception 'INVALID_STATE';end if;
 w:=private.manual_window(p_date,p_start,p_end,j.timezone_snapshot);if lower(w)<=now() then raise exception 'INVALID_STATE';end if;
 b:=private.job_snapshot(j.id);
 update public.jobs set checkout_date=p_date,start_at=lower(w),end_at=upper(w),manual_date_override=true,version=version+1,updated_at=now() where id=j.id;
 perform private.audit(j.id,'manual_date_override',b,p_key,jsonb_build_object('reason',p_reason,'oldDate',j.checkout_date,'newDate',p_date));
 for a in select cleaner_id from public.assignments where job_id=j.id and ended_at is null loop
  perform private.team_notice(j.property_id,j.id,'Cleaning moved from '||j.checkout_date||' to '||p_date||'. Please review your assignment.',a.cleaner_id);
 end loop;
end$$;
create function public.bloom_property_calendar_action(p_property uuid,p_action text,p_data jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.properties;u public.users;preview jsonb;r jsonb;input jsonb;b private.manual_bookings;j public.jobs;day date;ci date;co date;jobid uuid;eventid uuid;conflicts jsonb;before_b jsonb;before_j jsonb;assignment_record record;begin
 p:=private.manual_property(p_property);u:=private.require_actor();
 if jsonb_typeof(p_data) is distinct from 'object' or p_action not in ('preview','create_cleaning','move_cleaning','create_booking','edit_booking','cancel_booking','resolve_return') then raise exception 'VALIDATION_ERROR';end if;
 input:=jsonb_build_object('property',p.id,'action',p_action,'data',p_data);
 if p_action='preview' then return jsonb_build_object('ok',true,'preview',private.manual_preview(p.id,p_data));end if;
 r:=private.receipt('manual_calendar',p_key,input);if r is not null then return r;end if;
 -- Same property lock as imported finish_sync. Independent concurrent creates serialize.
 perform 1 from public.jobs where property_id=p.id order by id for update;
 if p_action='resolve_return' then
  if coalesce(length(trim(p_data->>'reason')),0) not between 1 and 1000 or p_data->>'resolution' not in ('confirmed','unrelated') then raise exception 'VALIDATION_ERROR';end if;
  select e.id into eventid from public.calendar_events e join public.calendar_sources s on s.id=e.source_id where e.id=(p_data->>'eventId')::uuid and s.property_id=p.id;
  select * into b from private.manual_bookings where id=(p_data->>'bookingId')::uuid and property_id=p.id;
  if eventid is null or b.id is null then raise exception 'NOT_FOUND';end if;
  if (p_data->>'eventVersion')::bigint is distinct from (select transition_version from public.calendar_events where id=eventid) or (p_data->>'bookingVersion')::integer is distinct from b.version then return private.manual_conflict('STALE_REVIEW','The booking or imported event changed. Review again.');end if;
  if p_data->>'resolution'='confirmed' and not exists(select 1 from public.calendar_events where id=eventid and source_status='active' and start_local_date=b.check_in and end_local_date=b.checkout and b.status='active') then return private.manual_conflict('RETURN_DATES_DIFFER','Returned blocks must match the active booking before confirmation.');end if;
  insert into private.calendar_returns(event_id,booking_id,state,event_version,booking_version,reviewed_by,reviewed_at)
  select eventid,b.id,p_data->>'resolution',transition_version,b.version,u.id,now() from public.calendar_events where id=eventid
  on conflict(event_id) do update set booking_id=excluded.booking_id,state=excluded.state,event_version=excluded.event_version,booking_version=excluded.booking_version,reviewed_by=u.id,reviewed_at=now();
  insert into private.manual_booking_history(booking_id,actor_id,before_snapshot,after_snapshot,request_id) values(b.id,u.id,to_jsonb(b),jsonb_build_object('returnReview',p_data),p_key);
  return private.save_receipt('manual_calendar',p_key,input,jsonb_build_object('ok',true,'bookingId',b.id));
 end if;
 if p_action in ('edit_booking','cancel_booking') then
  select * into b from private.manual_bookings where id=(p_data->>'bookingId')::uuid and property_id=p.id for update;
  if b.id is null then raise exception 'NOT_FOUND';end if;
  if b.status<>'active' or (p_data->>'bookingVersion')::integer is distinct from b.version then return private.manual_conflict('STALE_BOOKING','The booking changed. Reload its current details.');end if;
  select * into j from public.jobs where manual_booking_id=b.id and creation_origin='manual_booking';
  if j.id is not null and (j.status<>'open' or j.started_at is not null or j.start_at<=now()) then return private.manual_conflict('PROTECTED_CLEANING','The associated cleaning has started, completed, or is no longer a future open job.');end if;
  if exists(select 1 from public.assignments where job_id=j.id and ended_at is null) and not coalesce((p_data->>'confirmAssignments')::boolean,false) then return private.manual_conflict('ASSIGNMENTS_REQUIRE_CONFIRMATION','Confirm changes to the assigned checkout cleaning.',jsonb_build_object('jobId',j.id));end if;
  before_b:=to_jsonb(b);
  if p_action='cancel_booking' then
   if coalesce(length(trim(p_data->>'reason')),0) not between 1 and 1000 then raise exception 'VALIDATION_ERROR';end if;
   if j.id is not null then
    before_j:=private.job_snapshot(j.id);
    for assignment_record in select cleaner_id from public.assignments where job_id=j.id and ended_at is null loop perform private.team_notice(p.id,null,'A cleaning assignment was cancelled because its direct booking was cancelled.',assignment_record.cleaner_id);end loop;
    update public.assignments set ended_at=now(),end_reason='cancelled' where job_id=j.id and ended_at is null;
    update public.jobs set status='cancelled',cancellation_origin='admin',version=version+1 where id=j.id;
    perform private.audit(j.id,'manual_booking_cancel',before_j,p_key,p_data);
   end if;
   update private.manual_bookings set status='cancelled',version=version+1,updated_at=clock_timestamp() where id=b.id returning * into b;
   insert into private.manual_booking_history(booking_id,actor_id,before_snapshot,after_snapshot,request_id) values(b.id,u.id,before_b,to_jsonb(b),p_key);
   return private.save_receipt('manual_calendar',p_key,input,jsonb_build_object('ok',true,'bookingId',b.id,'version',b.version,'message','Booking cancelled in Bloom. Check Airbnb availability after its next refresh.'));
  end if;
 end if;
 day:=coalesce((p_data->>'date')::date,(p_data->>'checkout')::date);preview:=private.manual_preview(p.id,p_data);
 if p_data->>'reviewToken' is distinct from preview->>'reviewToken' then return private.manual_conflict('STALE_REVIEW','Availability or cleaning details changed. Review the current information.',jsonb_build_object('preview',preview));end if;
 if p_action in ('create_cleaning','move_cleaning') then
  if exists(select 1 from jsonb_array_elements(preview->'stays') s where (s->>'inStay')::boolean) and not coalesce((p_data->>'acknowledgeInStay')::boolean,false) then return private.manual_conflict('IN_STAY_ACK_REQUIRED','This cleaning window falls during a guest stay. Confirm it is intentional.',jsonb_build_object('stays',preview->'stays'));end if;
  if p_action='move_cleaning' then
   select * into j from public.jobs where id=(p_data->>'jobId')::uuid and property_id=p.id;
   if j.id is null then raise exception 'NOT_FOUND';end if;
   if j.version is distinct from (p_data->>'jobVersion')::integer then return private.manual_conflict('STALE_JOB','The cleaning changed. Review it again.');end if;
   if j.status<>'open' or j.started_at is not null or j.start_at<=now() then return private.manual_conflict('PROTECTED_CLEANING','Only future, unstarted open cleanings can be moved.');end if;
   if exists(select 1 from public.assignments where job_id=j.id and ended_at is null) and not coalesce((p_data->>'confirmAssignments')::boolean,false) then return private.manual_conflict('ASSIGNMENTS_REQUIRE_CONFIRMATION','Confirm the date change for the assigned cleaners.',jsonb_build_object('jobId',j.id));end if;
   if coalesce(length(trim(p_data->>'reason')),0) not between 1 and 1000 then raise exception 'VALIDATION_ERROR';end if;
   if exists(select 1 from public.jobs where property_id=p.id and checkout_date=day and id<>j.id and status<>'cancelled') and not coalesce((p_data->>'confirmAdditional')::boolean,false) then return private.manual_conflict('ADDITIONAL_CONFIRMATION_REQUIRED','Another cleaning exists on this date. Confirm both should remain.');end if;
   perform private.manual_move_job(j.id,day,coalesce((p_data->>'startTime')::time,(j.start_at at time zone j.timezone_snapshot)::time),coalesce((p_data->>'endTime')::time,(j.end_at at time zone j.timezone_snapshot)::time),p_key,p_data->>'reason');jobid:=j.id;
  else
   if exists(select 1 from jsonb_array_elements(preview->'jobs') job_item where job_item->>'status'<>'cancelled') and not coalesce((p_data->>'confirmAdditional')::boolean,false) then return private.manual_conflict('ADDITIONAL_CONFIRMATION_REQUIRED','Relevant cleaning work already exists. Choose a specific job to move, or confirm an additional paid cleaning.',jsonb_build_object('jobs',preview->'jobs'));end if;
   -- Optional explicit stay association; never infer identity from dates alone.
   if p_data->>'eventId' is not null and not exists(select 1 from public.calendar_events e join public.calendar_sources s on s.id=e.source_id where e.id=(p_data->>'eventId')::uuid and s.property_id=p.id) then raise exception 'NOT_FOUND';end if;
   if p_data->>'bookingId' is not null and not exists(select 1 from private.manual_bookings where id=(p_data->>'bookingId')::uuid and property_id=p.id and status='active') then raise exception 'NOT_FOUND';end if;
   jobid:=private.manual_create_job(p.id,day,p_data,'manual_cleaning',(p_data->>'bookingId')::uuid);
   if p_data->>'eventId' is not null then insert into public.job_events(job_id,event_id) values(jobid,(p_data->>'eventId')::uuid);update public.jobs set manual_date_override=true where id=jobid;end if;
   perform private.audit(jobid,'manual_cleaning_create',null,p_key,p_data);
  end if;
  return private.save_receipt('manual_calendar',p_key,input,jsonb_build_object('ok',true,'jobId',jobid,'job',private.job_dto(jobid)));
 end if;
 ci:=(p_data->>'checkIn')::date;co:=(p_data->>'checkout')::date;
 if ci is null or co is null or not isfinite(ci) or not isfinite(co) or co<=ci or co-ci>1830 or co<(now() at time zone p.timezone)::date then raise exception 'VALIDATION_ERROR';end if;
 select coalesce(jsonb_agg(c),'[]') into conflicts from (
 select jsonb_build_object('id',id,'source','manual','startDate',check_in,'endDate',checkout,'reason','OCCUPIED') c from private.manual_bookings where property_id=p.id and status='active' and id is distinct from b.id and check_in<co and ci<checkout
 union all select jsonb_build_object('id',e.id,'source',s.provider,'startDate',e.start_local_date,'endDate',e.end_local_date,'reason',case when e.kind='blocked' then 'BLOCKED' when e.review_required or e.missing_reason is not null or e.kind='unknown' then 'UNRESOLVED_SOURCE' else 'OCCUPIED' end)
 from public.calendar_events e join public.calendar_sources s on s.id=e.source_id where s.property_id=p.id and (e.source_status='active' or e.missing_reason is not null) and e.start_local_date<co and ci<e.end_local_date
 and not exists(select 1 from private.calendar_returns cr where cr.event_id=e.id and cr.booking_id=b.id and cr.state='confirmed' and cr.event_version=e.transition_version and cr.booking_version=b.version)) conflicts;
 if jsonb_array_length(conflicts)>0 then return private.manual_conflict('UNAVAILABLE_NIGHTS','One or more nights in this range are unavailable.',jsonb_build_object('periods',conflicts));end if;
 if p_action='edit_booking' then
  if coalesce(length(trim(p_data->>'reason')),0) not between 1 and 1000 then raise exception 'VALIDATION_ERROR';end if;
  if j.id is not null and not j.manual_date_override and co<>b.checkout then perform private.manual_move_job(j.id,co,(j.start_at at time zone j.timezone_snapshot)::time,(j.end_at at time zone j.timezone_snapshot)::time,p_key,p_data->>'reason');update public.jobs set manual_date_override=false where id=j.id;
  elsif j.id is not null and j.manual_date_override and (ci<>b.check_in or co<>b.checkout) then update public.jobs set review_required=true,version=version+1 where id=j.id;perform private.team_notice(p.id,j.id,'Booking dates changed. Review the manually moved cleaning.');end if;
  update private.manual_bookings set check_in=ci,checkout=co,internal_note=coalesce(p_data->>'note',internal_note),version=version+1,updated_at=clock_timestamp() where id=b.id returning * into b;
 else
  if p_action<>'create_booking' then raise exception 'VALIDATION_ERROR';end if;
  if exists(select 1 from public.jobs where property_id=p.id and checkout_date=co and status<>'cancelled') then
   if p_data->>'checkoutCleaning'='associate' then
    select * into j from public.jobs where id=(p_data->>'jobId')::uuid and property_id=p.id and checkout_date=co;
    if j.id is null or j.status<>'open' or j.started_at is not null or j.manual_booking_id is not null or exists(select 1 from public.job_events where job_id=j.id) then return private.manual_conflict('NOT_STANDALONE','Select an unstarted standalone cleaning with no booking association.');end if;
    if (p_data->>'jobVersion')::integer is distinct from j.version then return private.manual_conflict('STALE_JOB','The cleaning changed. Review it again.');end if;
    if not coalesce((p_data->>'confirmAssociation')::boolean,false) or (exists(select 1 from public.assignments where job_id=j.id and ended_at is null) and not coalesce((p_data->>'confirmAssignments')::boolean,false)) then return private.manual_conflict('ASSOCIATION_CONFIRMATION_REQUIRED','Confirm associating this cleaning without changing its staffing or compensation.');end if;
   elsif p_data->>'checkoutCleaning' is distinct from 'additional' or not coalesce((p_data->>'confirmAdditional')::boolean,false) then return private.manual_conflict('CHECKOUT_CLEANING_EXISTS','Choose the standalone cleaning to associate, or confirm an additional paid cleaning.',jsonb_build_object('jobs',preview->'jobs'));end if;
  elsif p_data->>'checkoutCleaning'='associate' then return private.manual_conflict('NOT_STANDALONE','No standalone cleaning exists to associate.');end if;
  insert into private.manual_bookings(property_id,check_in,checkout,internal_note,checkin_time,checkout_time,timezone,created_by) values(p.id,ci,co,coalesce(p_data->>'note',''),p.default_checkin_time,p.default_checkout_time,p.timezone,u.id) returning * into b;
  if j.id is not null then
   before_j:=private.job_snapshot(j.id);update public.jobs set manual_booking_id=b.id,creation_origin='manual_booking',version=version+1 where id=j.id;jobid:=j.id;perform private.audit(j.id,'manual_booking_associate',before_j,p_key,p_data);
  else jobid:=private.manual_create_job(p.id,co,'{}','manual_booking',b.id);perform private.audit(jobid,'manual_booking_checkout',null,p_key,jsonb_build_object('bookingId',b.id));end if;
 end if;
 insert into private.manual_booking_history(booking_id,actor_id,before_snapshot,after_snapshot,request_id) values(b.id,u.id,before_b,to_jsonb(b),p_key);
 return private.save_receipt('manual_calendar',p_key,input,jsonb_build_object('ok',true,'bookingId',b.id,'version',b.version,'jobId',coalesce(jobid,j.id),'source','manual','connectToAirbnb',not exists(select 1 from private.calendar_exports where property_id=p.id and enabled and owner_confirmed_at is not null),'message','Booking saved in Bloom. If you’ve connected your Bloom calendar to Airbnb, these dates will be blocked when Airbnb next refreshes it.'));
end$$;
-- Subscription URLs disclose generic manual availability only. No imported entries.
create function public.bloom_calendar_export_settings(p_property uuid,p_action text default 'status',p_key text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.properties;x private.calendar_exports;r jsonb;t text;input jsonb:=jsonb_build_object('property',p_property,'action',p_action);begin
 p:=private.manual_property(p_property);
 if p_action not in ('status','create','regenerate','disable','confirm') then raise exception 'VALIDATION_ERROR';end if;
 if p_action<>'status' then r:=private.receipt('calendar_export',p_key,input);if r is not null then return r;end if;end if;
 select * into x from private.calendar_exports where property_id=p.id for update;
 if p_action='regenerate' or (p_action='create' and (x.property_id is null or not x.enabled)) then
  t:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  insert into private.calendar_exports(property_id,token,token_hash) values(p.id,t,encode(sha256(convert_to(t,'UTF8')),'hex'))
  on conflict(property_id) do update set token=excluded.token,token_hash=excluded.token_hash,enabled=true,last_fetched_at=null,owner_confirmed_at=null,updated_at=now();
 elsif p_action='disable' then update private.calendar_exports set enabled=false,owner_confirmed_at=null,updated_at=now() where property_id=p.id;
 elsif p_action='confirm' then
  if x.property_id is null or not x.enabled then raise exception 'INVALID_STATE';end if;
  update private.calendar_exports set owner_confirmed_at=now() where property_id=p.id;
 end if;
 select * into x from private.calendar_exports where property_id=p.id;
 r:=jsonb_build_object('enabled',coalesce(x.enabled,false),'token',case when x.enabled then x.token end,'lastFetchedAt',x.last_fetched_at,'ownerConfirmedAt',x.owner_confirmed_at);
 if p_action<>'status' then return private.save_receipt('calendar_export',p_key,input,r);end if;return r;
end$$;
create function public.bloom_calendar_export_feed(p_token_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare x private.calendar_exports;begin
 perform private.calendar_actor(null);
 if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then return null;end if;
 select e.* into x from private.calendar_exports e join public.properties p on p.id=e.property_id where e.token_hash=p_token_hash and e.enabled and p.active and p.deleted_at is null for update of e;
 if not found then return null;end if;
 update private.calendar_exports set last_fetched_at=clock_timestamp() where property_id=x.property_id;
 return jsonb_build_object('events',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'checkIn',check_in,'checkout',checkout,'updatedAt',updated_at,'sequence',version) order by check_in,id),'[]') from private.manual_bookings where property_id=x.property_id and status='active'));
end$$;
create function public.bloom_manual_calendar(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u public.users;begin
 u:=private.require_actor();if u.role not in ('owner','admin') then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<p_from or p_to-p_from>1830 then raise exception 'VALIDATION_ERROR';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'bookingId',b.id,'propertyId',p.id,'propertyName',p.name,'timezone',b.timezone,'startDate',b.check_in,'endDate',b.checkout,'providers',jsonb_build_array('manual'),'source','manual','kind','reservation','removed',b.status='cancelled','changes',(select coalesce(jsonb_agg(jsonb_build_object('id',r.event_id,'type','conflict','message','An imported calendar period overlaps this direct booking. Review its origin.','acknowledged',false)),'[]') from private.calendar_returns r join public.calendar_events e on e.id=r.event_id where r.booking_id=b.id and e.source_status='active' and (r.state='ambiguous' or r.event_version<>e.transition_version or r.booking_version<>b.version))) order by b.check_in,b.id),'[]') from private.manual_bookings b join public.properties p on p.id=b.property_id where p.deleted_at is null and b.check_in<=p_to and b.checkout>=p_from and (u.role='admin' or exists(select 1 from public.property_owners where property_id=p.id and owner_id=u.id)));
end$$;
alter function public.bloom_owner_calendar(date,date) rename to bloom_owner_calendar_before_manual;
create function public.bloom_owner_calendar(p_from date,p_to date) returns jsonb language sql stable security definer set search_path='' as $$select public.bloom_owner_calendar_before_manual(p_from,p_to)||public.bloom_manual_calendar(p_from,p_to)$$;
alter function public.bloom_owner_analytics(date,date,uuid[]) rename to bloom_owner_analytics_before_manual;
create function public.bloom_owner_analytics(p_from date,p_to_exclusive date,p_properties uuid[] default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;events jsonb;begin
 r:=public.bloom_owner_analytics_before_manual(p_from,p_to_exclusive,p_properties);
 select coalesce(jsonb_agg(case when cr.state='confirmed' and cr.event_version=e.transition_version and cr.booking_version=b.version and b.status='active' then v||jsonb_build_object('removed',true)
 when cr.state='ambiguous' or cr.event_version<>e.transition_version or cr.booking_version<>b.version then v||jsonb_build_object('confirmed',false,'kind','unknown','origin','unknown') else v end),'[]') into events
 from jsonb_array_elements(r->'events') v left join private.calendar_returns cr on cr.event_id=(v->>'id')::uuid left join public.calendar_events e on e.id=cr.event_id left join private.manual_bookings b on b.id=cr.booking_id;
 select events||coalesce(jsonb_agg(jsonb_build_object('id',b.id,'propertyId',b.property_id,'startDate',b.check_in,'endDate',b.checkout,'kind','reservation','removed',b.status='cancelled','confirmed',true,'origin','manual')),'[]') into events
 from private.manual_bookings b where b.property_id in(select (x->>'id')::uuid from jsonb_array_elements(r->'properties') x) and b.check_in<p_to_exclusive and b.checkout>p_from;
 return jsonb_set(r,'{events}',events);
end$$;
alter function private.job_dto(uuid) rename to job_dto_before_manual;
create function private.job_dto(p_job uuid) returns jsonb language sql stable security definer set search_path='' as $$select private.job_dto_before_manual(p_job)||jsonb_build_object('creationOrigin',creation_origin,'bookingId',manual_booking_id,'dateOverridden',manual_date_override,'jobInstructions',job_instructions) from public.jobs where id=p_job$$;
-- A date match is not booking identity. Explicitly reviewed or preserved stable UID
-- returns are suppressed, while ambiguous periods remain unavailable and reviewable.
create function private.manual_import_conflict(p_event uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.calendar_events e join public.calendar_sources s on s.id=e.source_id join private.manual_bookings b on b.property_id=s.property_id and b.status='active' and b.check_in<e.end_local_date and e.start_local_date<b.checkout where e.id=p_event) or exists(select 1 from private.calendar_returns where event_id=p_event and state<>'unrelated')
$$;
create or replace function private.calendar_job_eligible(e public.calendar_events) returns boolean language sql stable security definer set search_path='' as $$select e.kind='reservation' and e.evidence='airbnb-reservation-link' and not e.review_required and not private.manual_import_conflict(e.id)$$;
create or replace function private.calendar_apply(p_source uuid,p_run uuid,p_actor uuid,p_snapshot jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.properties;item jsonb;e public.calendar_events;old_e public.calendar_events;j public.jobs;b jsonb;pair record;
 changed uuid[]:='{}';n_created integer:=0;n_updated integer:=0;n_removed integer:=0;n_unchanged integer:=0;n_conflicts integer:=0;
 was_new boolean;has_claim boolean;notice_type text;note boolean;begin
 select p0.* into p from public.properties p0 join public.calendar_sources s on s.property_id=p0.id where s.id=p_source;
 -- Complete snapshots retain review-only events without blocking independent reservations.
 for item in select value from jsonb_array_elements(p_snapshot->'events') loop
 select * into old_e from public.calendar_events where source_id=p_source and uid=item->>'uid' and recurrence_key=item->>'recurrenceKey';was_new:=not found;
 if not was_new and private.calendar_event_value(old_e)=item and old_e.missing_reason is null then
 update public.calendar_events set last_seen_run_id=p_run where id=old_e.id;n_unchanged:=n_unchanged+1;continue;end if;
 if was_new then
 insert into public.calendar_events(source_id,uid,recurrence_key,start_local_date,end_local_date,kind,content_hash,event_status,source_status,evidence,review_required,last_seen_run_id)
 values(p_source,item->>'uid',item->>'recurrenceKey',(item->>'startDate')::date,(item->>'endDate')::date,item->>'kind',item->>'contentHash',item->>'status',case when item->>'status'='cancelled' then 'removed' else 'active' end,item->>'evidence',(item->>'reviewRequired')::boolean,p_run) returning * into e;
 n_created:=n_created+1;
 else
 update public.calendar_events set start_local_date=(item->>'startDate')::date,end_local_date=(item->>'endDate')::date,kind=item->>'kind',content_hash=item->>'contentHash',event_status=item->>'status',source_status=case when item->>'status'='cancelled' then 'removed' else 'active' end,evidence=item->>'evidence',review_required=(item->>'reviewRequired')::boolean,missing_reason=null,last_seen_run_id=p_run,transition_version=transition_version+1,updated_at=clock_timestamp() where id=old_e.id returning * into e;
 if e.event_status='cancelled' then n_removed:=n_removed+1;else n_updated:=n_updated+1;end if;
 end if;
 insert into public.calendar_event_history(event_id,run_id,before_snapshot,after_snapshot) values(e.id,p_run,case when was_new then '{}'::jsonb else to_jsonb(old_e) end,to_jsonb(e));
 changed:=array_append(changed,e.id);
 if not was_new or not private.calendar_job_eligible(e) or e.event_status='cancelled' then
 perform private.calendar_notice(e.id,null,p_run,case when e.source_status='removed' then 'removed' when was_new then 'conflict' else 'changed' end);
 end if;
 end loop;
 for old_e in select * from public.calendar_events where source_id=p_source and source_status='active' and last_seen_run_id is distinct from p_run loop
 update public.calendar_events set source_status='removed',missing_reason='horizon_unknown',transition_version=transition_version+1,updated_at=clock_timestamp() where id=old_e.id returning * into e;
 insert into public.calendar_event_history(event_id,run_id,before_snapshot,after_snapshot) values(e.id,p_run,to_jsonb(old_e),to_jsonb(e));
 changed:=array_append(changed,e.id);n_removed:=n_removed+1;perform private.calendar_notice(e.id,null,p_run,'removed');
 end loop;
 -- Preserve external provenance, including identical-date feedback loops.
 for pair in select ce.id event_id,ce.transition_version,ce.uid,ce.start_local_date,ce.end_local_date,mb.id booking_id,mb.version booking_version,mb.check_in,mb.checkout
 from public.calendar_events ce join private.manual_bookings mb on mb.property_id=p.id and mb.status='active' and mb.check_in<ce.end_local_date and ce.start_local_date<mb.checkout
 where ce.source_id=p_source and ce.source_status='active' order by ce.id,mb.id loop
 insert into private.calendar_returns(event_id,booking_id,state,event_version,booking_version)
 values(pair.event_id,pair.booking_id,case when pair.uid='bloom-booking-'||pair.booking_id||'@bloomcleaning.org' and pair.start_local_date=pair.check_in and pair.end_local_date=pair.checkout then 'confirmed' else 'ambiguous' end,pair.transition_version,pair.booking_version)
 on conflict(event_id) do update set state=case when private.calendar_returns.event_version=excluded.event_version and private.calendar_returns.booking_version=excluded.booking_version then private.calendar_returns.state else excluded.state end,event_version=excluded.event_version,booking_version=excluded.booking_version;
 if (select state='ambiguous' from private.calendar_returns where event_id=pair.event_id) then
  if private.calendar_notice(pair.event_id,null,p_run,'conflict','manual:'||pair.booking_id||':'||pair.booking_version) then n_conflicts:=n_conflicts+1;end if;
  for j in select * from public.jobs where manual_booking_id=pair.booking_id and status='open' and not review_required loop
   b:=private.job_snapshot(j.id);update public.jobs set review_required=true,version=version+1 where id=j.id;perform private.calendar_audit(j.id,p_run,p_actor,'manual_import_overlap',b);
  end loop;
 end if;
 end loop;
 -- Preserve protected linked jobs before considering any new checkout date.
 for e in select * from public.calendar_events where id=any(changed) order by id loop
 notice_type:=case when e.source_status='removed' then 'removed' else 'changed' end;
 for j in select j0.* from public.jobs j0 join public.job_events je on je.job_id=j0.id where je.event_id=e.id order by j0.id loop
 b:=private.job_snapshot(j.id);has_claim:=exists(select 1 from public.assignments where job_id=j.id and ended_at is null);
 note:=private.calendar_notice(e.id,j.id,p_run,notice_type);
 if j.status='completed' then
 if note then perform private.calendar_audit(j.id,p_run,p_actor,'calendar_completed_warning',b);end if;
 elsif j.status='open' and (has_claim or j.started_at is not null or j.manual_date_override or j.creation_origin<>'imported' or j.review_required or e.missing_reason is not null or (e.source_status='active' and not private.calendar_job_eligible(e))) then
 if not j.review_required then update public.jobs set review_required=true,version=version+1,updated_at=clock_timestamp() where id=j.id;end if;
 if note then perform private.calendar_audit(j.id,p_run,p_actor,'calendar_hold',b);end if;
 elsif j.status='open' and (e.source_status='removed' or e.end_local_date<>j.checkout_date) then
 perform private.calendar_link(j.id,e.id,p_run,p_actor,'unlinked');
 if not exists(select 1 from public.job_events je join public.calendar_events x on x.id=je.event_id where je.job_id=j.id and ((x.source_status='active' and x.end_local_date=j.checkout_date) or x.missing_reason is not null)) then
 update public.jobs set status='cancelled',cancellation_origin='calendar',version=version+1,updated_at=clock_timestamp() where id=j.id;
 end if;
 perform private.calendar_audit(j.id,p_run,p_actor,'calendar_reconcile_unclaimed',b);
 elsif note then perform private.calendar_audit(j.id,p_run,p_actor,'calendar_event_changed',b);
 end if;
 end loop;
 end loop;
 -- Property/date uniqueness constrains turnovers, not source event identity.
 for e in select x.* from public.calendar_events x join public.calendar_sources s on s.id=x.source_id where s.property_id=p.id and x.source_status='active' and private.calendar_job_eligible(x) and x.id=any(changed) order by x.end_local_date,x.id loop
 if exists(select 1 from public.job_events je join public.jobs z on z.id=je.job_id where je.event_id=e.id and (z.manual_date_override or z.creation_origin<>'imported')) then continue;end if;
 if exists(select 1 from public.job_events je join public.jobs z on z.id=je.job_id where je.event_id=e.id and (z.status='completed' or (z.status='open' and (z.review_required or z.manual_date_override or z.creation_origin<>'imported' or z.started_at is not null or exists(select 1 from public.assignments a where a.job_id=z.id and a.ended_at is null)))) and z.checkout_date<>e.end_local_date) then continue;end if;
 select * into j from public.jobs where property_id=p.id and checkout_date=e.end_local_date and creation_origin='imported' and not manual_date_override;
 if found then
 if exists(select 1 from public.job_events where job_id=j.id and event_id=e.id) then
 if e.review_required and j.status='open' and not j.review_required then
 b:=private.job_snapshot(j.id);update public.jobs set review_required=true,version=version+1,updated_at=clock_timestamp() where id=j.id;perform private.calendar_audit(j.id,p_run,p_actor,'calendar_hold',b);
 end if;continue;end if;
 b:=private.job_snapshot(j.id);
 if j.status='completed' or j.review_required or exists(select 1 from public.assignments where job_id=j.id and ended_at is null) or (j.status='cancelled' and j.cancellation_origin is distinct from 'calendar') then
 note:=private.calendar_notice(e.id,j.id,p_run,'conflict','protected_turnover');
 if note then
 n_conflicts:=n_conflicts+1;perform private.calendar_link(j.id,e.id,p_run,p_actor,'observed_protected');
 if j.status='open' and not j.review_required then update public.jobs set review_required=true,version=version+1,updated_at=clock_timestamp() where id=j.id;end if;
 perform private.calendar_audit(j.id,p_run,p_actor,'calendar_protected_provenance',b);end if;continue;
 end if;
 if j.status='cancelled' then update public.jobs set status='open',cancellation_origin=null,version=version+1,updated_at=clock_timestamp() where id=j.id;end if;
 else
 b:=null;
 if (((e.end_local_date+time '11:00') at time zone p.timezone) at time zone p.timezone) is distinct from e.end_local_date+time '11:00'
 or (((e.end_local_date+time '15:00') at time zone p.timezone) at time zone p.timezone) is distinct from e.end_local_date+time '15:00' then perform private.calendar_error('VALIDATION_ERROR');end if;
 insert into public.jobs(property_id,checkout_date,start_at,end_at,timezone_snapshot,solo_rate_cents_snapshot,review_required)
 values(p.id,e.end_local_date,(e.end_local_date+time '11:00') at time zone p.timezone,(e.end_local_date+time '15:00') at time zone p.timezone,p.timezone,p.solo_rate_cents,e.review_required) returning * into j;
 end if;
 perform private.calendar_link(j.id,e.id,p_run,p_actor,'linked');perform private.calendar_audit(j.id,p_run,p_actor,'calendar_link_event',b);
 end loop;
 -- Nonidentical overlapping periods are conflicts. Exact dates across feeds keep distinct
 -- source identities and share a turnover without manufacturing a conflict.
 for pair in select a.id a_id,b0.id b_id,a.transition_version a_version,b0.transition_version b_version,a.end_local_date a_end,b0.end_local_date b_end
 from public.calendar_events a join public.calendar_sources sa on sa.id=a.source_id
 join public.calendar_events b0 on a.id<b0.id join public.calendar_sources sb on sb.id=b0.source_id
 where sa.property_id=p.id and sb.property_id=p.id and a.source_status='active' and b0.source_status='active'
 and (a.id=any(changed) or b0.id=any(changed)) and (a.start_local_date,a.end_local_date) is distinct from (b0.start_local_date,b0.end_local_date)
 and ((a.start_local_date<b0.end_local_date and b0.start_local_date<a.end_local_date) or a.end_local_date=b0.end_local_date)
 loop
 for j in select * from public.jobs where property_id=p.id and checkout_date in (pair.a_end,pair.b_end) order by id loop
 b:=private.job_snapshot(j.id);
 note:=private.calendar_notice(pair.a_id,j.id,p_run,'conflict','overlap:'||pair.b_id||':'||pair.b_version);
 note:=private.calendar_notice(pair.b_id,j.id,p_run,'conflict','overlap:'||pair.a_id||':'||pair.a_version) or note;
 if note then
 n_conflicts:=n_conflicts+1;if j.status='open' and not j.review_required then update public.jobs set review_required=true,version=version+1,updated_at=clock_timestamp() where id=j.id;end if;
 perform private.calendar_audit(j.id,p_run,p_actor,'calendar_overlap',b);end if;
 end loop;
 end loop;
 return jsonb_build_object('runId',p_run,'created',n_created,'updated',n_updated,'removed',n_removed,'unchanged',n_unchanged,'conflicts',n_conflicts,'status','success');
end $$;

revoke all on function public.bloom_property_calendar_action(uuid,text,jsonb,text),public.bloom_calendar_export_settings(uuid,text,text),public.bloom_manual_calendar(date,date),public.bloom_owner_calendar(date,date),public.bloom_owner_analytics(date,date,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.bloom_property_calendar_action(uuid,text,jsonb,text),public.bloom_calendar_export_settings(uuid,text,text),public.bloom_manual_calendar(date,date),public.bloom_owner_calendar(date,date),public.bloom_owner_analytics(date,date,uuid[]) to authenticated;
revoke all on function public.bloom_calendar_export_feed(text) from public,anon,authenticated;
grant execute on function public.bloom_calendar_export_feed(text) to service_role;
do $$declare r record;begin
 for r in select p.oid::regprocedure f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and (p.proname like 'manual_%' or p.proname='job_dto_before_manual') loop execute format('revoke all on function %s from public,anon,authenticated,service_role',r.f);end loop;
end$$;
-- Preserve imported provenance while exposing return classification to admin metrics.
alter function public.bloom_admin_property_calendar_events(uuid,uuid) rename to bloom_admin_property_calendar_events_before_manual;
create function public.bloom_admin_property_calendar_events(p_property uuid,p_cursor uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;items jsonb;begin
 r:=public.bloom_admin_property_calendar_events_before_manual(p_property,p_cursor);
 select coalesce(jsonb_agg(v||jsonb_build_object('manualReturn',case
 when cr.state='confirmed' and cr.event_version=e.transition_version and cr.booking_version=b.version and b.status='active' then 'confirmed'
 when cr.state='ambiguous' or cr.event_version<>e.transition_version or cr.booking_version<>b.version then 'ambiguous'
 else null end) order by v->>'id'),'[]') into items
 from jsonb_array_elements(r->'items') v left join private.calendar_returns cr on cr.event_id=(v->>'id')::uuid
 left join public.calendar_events e on e.id=cr.event_id left join private.manual_bookings b on b.id=cr.booking_id;
 return jsonb_set(r,'{items}',items);
end$$;
revoke all on function public.bloom_admin_property_calendar_events(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.bloom_admin_property_calendar_events(uuid,uuid) to authenticated;

commit;
