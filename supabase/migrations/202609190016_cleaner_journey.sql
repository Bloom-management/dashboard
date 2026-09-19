-- No fixtures or external delivery. Property configuration is explicit and versioned.
begin;
alter table public.properties add column cleaning_config jsonb;
alter table public.jobs add column cleaning_config jsonb, add column started_at timestamptz,
 add column started_by uuid references public.users, add column completion_receipt jsonb;
alter table public.job_photos add column room_id uuid;
create table public.job_supply_reports (
 job_id uuid not null references public.jobs, supply_id uuid not null, name text not null,
 level text not null check(level in ('full','moderate','low','empty','not_found')),
 reported_by uuid not null references public.users, reported_at timestamptz not null,
 primary key(job_id,supply_id)
);
create table public.admin_notification_events (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs,
 event_type text not null check(event_type='job.completed'), payload jsonb not null,
 created_at timestamptz not null default now(), unique(job_id,event_type)
);
alter table public.job_supply_reports enable row level security;
alter table public.admin_notification_events enable row level security;
revoke all on public.job_supply_reports,public.admin_notification_events from anon,authenticated;
grant select on public.admin_notification_events to authenticated;
create policy admin_events on public.admin_notification_events for select to authenticated using(private.is_admin());

create function private.snapshot_cleaning_config() returns trigger language plpgsql security definer set search_path='' as $$ begin
 select cleaning_config into new.cleaning_config from public.properties where id=new.property_id;
 return new;end $$;
create trigger cleaning_config_snapshot before insert on public.jobs for each row execute function private.snapshot_cleaning_config();

create function public.bloom_cleaning_config(p_property uuid,p_config jsonb default null,p_key text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;old_config jsonb;r jsonb;v jsonb;seen uuid[];input jsonb:=jsonb_build_object('property',p_property,'config',p_config);begin
 u:=private.require_actor('admin');
 if p_config is not null then r:=private.receipt('cleaning_config',p_key,input);if r is not null then return r;end if;end if;
 select cleaning_config into old_config from public.properties where id=p_property for update;if not found then raise exception 'NOT_FOUND';end if;
 if p_config is null then return old_config;end if;
 if jsonb_typeof(p_config)<>'object' or jsonb_typeof(p_config->'rooms') is distinct from 'array' or jsonb_typeof(p_config->'supplies') is distinct from 'array'
 or jsonb_array_length(p_config->'rooms') not between 2 and 100 or jsonb_array_length(p_config->'supplies')>100 then raise exception 'VALIDATION_ERROR';end if;
 if coalesce((p_config->>'version')::integer,0)<>coalesce((old_config->>'version')::integer,0) then raise exception 'CONFLICT';end if;
 seen:=array[]::uuid[];
 for v in select value from jsonb_array_elements(p_config->'rooms') loop
 if jsonb_typeof(v)<>'object' or v->>'id' is null or (v->>'id')::uuid=any(seen) or coalesce(length(trim(v->>'label')),0) not between 1 and 100
 or v->>'type' is null or v->>'type' not in ('bedrooms','bathrooms','kitchen','living_room') or v->'requiredPhoto' is distinct from 'true'::jsonb
 then raise exception 'VALIDATION_ERROR';end if;
 seen:=array_append(seen,(v->>'id')::uuid);
 end loop;
 if not exists(select 1 from jsonb_array_elements(p_config->'rooms') room_check where room_check->>'type'='kitchen') or not exists(select 1 from jsonb_array_elements(p_config->'rooms') room_check where room_check->>'type'='living_room') then raise exception 'VALIDATION_ERROR';end if;
 seen:=array[]::uuid[];
 for v in select value from jsonb_array_elements(p_config->'supplies') loop
 if jsonb_typeof(v)<>'object' or v->>'id' is null or (v->>'id')::uuid=any(seen) or coalesce(length(trim(v->>'name')),0) not between 1 and 100 then raise exception 'VALIDATION_ERROR';end if;
 seen:=array_append(seen,(v->>'id')::uuid);
 end loop;
 r:=jsonb_build_object('version',coalesce((old_config->>'version')::integer,0)+1,'rooms',p_config->'rooms','supplies',p_config->'supplies');
 update public.properties set cleaning_config=r where id=p_property;
 return private.save_receipt('cleaning_config',p_key,input,r);end $$;

create function public.bloom_job_journey(p_job uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u public.users;j public.jobs;reports jsonb;begin
 u:=private.require_actor();if u.role not in ('cleaner','admin') then raise exception 'FORBIDDEN';end if;select * into j from public.jobs where id=p_job;
 if j.id is null or (u.role<>'admin' and not private.assigned(p_job)) then raise exception 'NOT_FOUND';end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into reports from (
 select distinct on (r.supply_id) r.supply_id as "supplyId",r.level,r.reported_at as "reportedAt"
 from public.job_supply_reports r join public.jobs other on other.id=r.job_id where other.property_id=j.property_id
 order by r.supply_id,r.reported_at desc,r.job_id desc) x;
 return jsonb_build_object('job',private.job_dto(p_job),'config',coalesce(j.cleaning_config,(select cleaning_config from public.properties where id=j.property_id)),
 'startedAt',j.started_at,'startedBy',j.started_by,'previousReports',reports,'receipt',j.completion_receipt);
 end $$;

create function public.bloom_job_start(p_job uuid,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;j public.jobs;r jsonb;c jsonb;i jsonb:=jsonb_build_object('job',p_job);begin
 u:=private.require_actor();if u.role not in ('cleaner','admin') then raise exception 'FORBIDDEN';end if;
 if not private.assigned(p_job) then raise exception 'NOT_FOUND';end if;
 r:=private.receipt('job_start',p_key,i);if r is not null then return r;end if;
 select cleaning_config into c from public.properties where id=(select property_id from public.jobs where id=p_job) for update;
 select * into j from public.jobs where id=p_job for update;
 if j.id is null or not private.assigned(p_job) then raise exception 'NOT_FOUND';end if;
 if j.status<>'open' or clock_timestamp()<j.start_at then raise exception 'INVALID_STATE';end if;
 if j.review_required then raise exception 'REVIEW_REQUIRED';end if;
 if coalesce(j.cleaning_config,c) is null then raise exception 'CONFIGURATION_ERROR';end if;
 update public.jobs set cleaning_config=coalesce(cleaning_config,c),started_at=coalesce(started_at,clock_timestamp()),started_by=coalesce(started_by,u.id),version=version+case when started_at is null then 1 else 0 end where id=p_job;
 return private.save_receipt('job_start',p_key,i,public.bloom_job_journey(p_job));end $$;

create or replace function private.photo_dto(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.id,'jobId',p.job_id,'uploaderId',p.uploader_id,'uploaderName',u.display_name,'category',p.category,'roomId',p.room_id,'createdAt',p.created_at,'state',p.state)
 from public.job_photos p join public.users u on u.id=p.uploader_id where p.id=p_id $$;
create function public.bloom_room_photo_prepare(p_job uuid,p_room uuid,p_mime text,p_bytes integer,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;j public.jobs;room jsonb;r jsonb;photo uuid:=gen_random_uuid();i jsonb:=jsonb_build_object('job',p_job,'room',p_room,'mime',p_mime,'bytes',p_bytes);begin
 u:=private.require_actor();if u.role not in ('cleaner','admin') then raise exception 'FORBIDDEN';end if;
 r:=private.receipt('room_photo_prepare',p_key,i);if r is not null then return r;end if;
 select * into j from public.jobs where id=p_job for update;
 if not private.photo_access(p_job,true) then raise exception 'NOT_FOUND';end if;
 if j.started_at is null then raise exception 'INVALID_STATE';end if;
 select value into room from jsonb_array_elements(j.cleaning_config->'rooms') where value->>'id'=p_room::text;
 if room is null or p_mime is null or p_mime not in ('image/jpeg','image/png','image/webp') or p_bytes is null or p_bytes not between 1 and 10485760 then raise exception 'VALIDATION_ERROR';end if;
 insert into public.job_photos(id,job_id,uploader_id,category,room_id,object_path,mime,bytes) values(photo,p_job,u.id,room->>'type',p_room,p_job::text||'/'||photo::text,p_mime,p_bytes);
 r:=jsonb_build_object('photoId',photo,'bucket','job-photos','path',p_job::text||'/'||photo::text);
 return private.save_receipt('room_photo_prepare',p_key,i,r);end $$;

create function private.complete_cleaning(p_job uuid,p_payload jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;j public.jobs;r jsonb;v jsonb;item jsonb;room jsonb;event_id uuid;at_time timestamptz;input jsonb:=jsonb_build_object('job',p_job,'payload',p_payload);begin
 u:=private.require_actor();if u.role not in ('cleaner','admin') then raise exception 'FORBIDDEN';end if;
 r:=private.receipt('cleaning_complete',p_key,input);if r is not null then return r;end if;
 perform 1 from public.properties where id=(select property_id from public.jobs where id=p_job) for update;
 select * into j from public.jobs where id=p_job for update;
 if j.id is null or not private.assigned(p_job) then raise exception 'NOT_FOUND';end if;
 if j.status='completed' and j.completion_receipt is not null then
 return private.save_receipt('cleaning_complete',p_key,input,jsonb_build_object('job',private.job_dto(p_job),'receipt',j.completion_receipt));end if;
 if j.status<>'open' or clock_timestamp()<j.start_at or j.started_at is null then raise exception 'INVALID_STATE';end if;
 if j.review_required then raise exception 'REVIEW_REQUIRED';end if;
 if j.cleaning_config is null then raise exception 'CONFIGURATION_ERROR';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('configVersion','answers','notes'))
 or (p_payload->>'configVersion')::integer is distinct from (j.cleaning_config->>'version')::integer then raise exception 'CONFLICT';end if;
 if jsonb_typeof(p_payload->'answers') is distinct from 'array' or jsonb_typeof(p_payload->'notes') is distinct from 'string' or length(p_payload->>'notes')>1500 then raise exception 'VALIDATION_ERROR';end if;
 for room in select value from jsonb_array_elements(j.cleaning_config->'rooms') loop
 if not exists(select 1 from public.job_photos where job_id=p_job and state='ready' and room_id=(room->>'id')::uuid) then raise exception 'PHOTO_COVERAGE_REQUIRED';end if;
 end loop;
 if jsonb_array_length(p_payload->'answers')<>jsonb_array_length(j.cleaning_config->'supplies') then raise exception 'VALIDATION_ERROR';end if;
 at_time:=clock_timestamp();
 for item in select value from jsonb_array_elements(j.cleaning_config->'supplies') loop
 if (select count(*) from jsonb_array_elements(p_payload->'answers') a where a->>'supplyId'=item->>'id')<>1 then raise exception 'VALIDATION_ERROR';end if;
 select value into v from jsonb_array_elements(p_payload->'answers') where value->>'supplyId'=item->>'id';
 if v->>'level' is null or v->>'level' not in ('full','moderate','low','empty','not_found') then raise exception 'VALIDATION_ERROR';end if;
 insert into public.job_supply_reports values(p_job,(item->>'id')::uuid,item->>'name',v->>'level',u.id,at_time);
 end loop;
 -- Existing completion implementation retains pay, capacity, review, eligibility, and audit checks.
 r:=jsonb_build_object('jobId',p_job,'completedAt',at_time,'completedBy',u.id,'notes',p_payload->>'notes','reports',
 (select coalesce(jsonb_agg(jsonb_build_object('supplyId',supply_id,'name',name,'level',level)),'[]') from public.job_supply_reports where job_id=p_job));
 insert into public.admin_notification_events(job_id,event_type,payload) values(p_job,'job.completed',r) returning id into event_id;
 r:=r||jsonb_build_object('eventId',event_id);
 update public.jobs set completion_receipt=r where id=p_job;
 perform private.job_action_v1(p_job,'complete',p_key);
 return private.save_receipt('cleaning_complete',p_key,input,jsonb_build_object('job',private.job_dto(p_job),'receipt',r));end $$;

create or replace function private.job_action_v1(p_job uuid,p_action text,p_key text,p_expected_version integer default null,p_payload jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;j public.jobs;p public.properties;a public.assignments; n integer;s smallint;r jsonb;b jsonb;t timestamptz;
 target public.users;input jsonb:=jsonb_build_object('job',p_job,'action',p_action,'version',p_expected_version,'payload',p_payload);begin
 u:=private.require_actor();
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or exists(select 1 from jsonb_object_keys(p_payload) k where not (k=any(case p_action when 'cancel' then array['reason'] when 'reassign' then array['reason','cleanerId','removeAssignmentId'] when 'keep' then array['reason'] when 'reschedule' then array['reason','checkoutDate'] else array[]::text[] end))) then raise exception 'VALIDATION_ERROR';end if;
 if p_action in ('cancel','reassign','keep','reschedule') then if u.role<>'admin' then raise exception 'FORBIDDEN';end if;
 elsif p_action in ('claim','withdraw','complete') then if u.role not in ('cleaner','admin') then raise exception 'FORBIDDEN';end if;else raise exception 'VALIDATION_ERROR';end if;
 r:=private.receipt('job_action',p_key,input);if r is not null then return r;end if;
 select * into j from public.jobs where id=p_job for update;if not found then raise exception 'NOT_FOUND';end if;
 select * into p from public.properties where id=j.property_id;
 select * into a from public.assignments where job_id=j.id and cleaner_id=u.id and ended_at is null;
 if u.role='cleaner' and a.id is null and p.city_id is distinct from u.approved_city_id then raise exception 'CITY_MISMATCH';end if;
 if p_action='complete' and j.status='completed' and a.id is not null then return private.save_receipt('job_action',p_key,input,private.job_dto(j.id));end if;
 if j.status<>'open' then raise exception 'INVALID_STATE';end if;
 if p_action in ('cancel','reassign','keep','reschedule') and (p_expected_version is null or p_expected_version<>j.version) then raise exception 'CONFLICT';end if;
 if p_action in ('cancel','reassign','keep','reschedule') and (coalesce(length(trim(p_payload->>'reason')),0)=0) then raise exception 'VALIDATION_ERROR';end if;
 t:=clock_timestamp();b:=private.job_snapshot(j.id);
 if p_action='claim' then
 if j.review_required then raise exception 'REVIEW_REQUIRED';end if;
 if not p.active or not exists(select 1 from public.cities where id=p.city_id and active) or t>=j.end_at then raise exception 'INVALID_STATE';end if;
 -- Lock the user's city against concurrent admin approval while checking eligibility.
 select * into u from public.users where id=u.id for update;
 t:=clock_timestamp();if t>=j.end_at then raise exception 'INVALID_STATE';end if;
 if u.role not in ('cleaner','admin') or (u.role='cleaner' and p.city_id is distinct from u.approved_city_id) then raise exception 'CITY_MISMATCH';end if;
 if a.id is not null then raise exception 'ALREADY_ASSIGNED';end if;
 select candidate into s from generate_series(1,2) candidate where not exists(select 1 from public.assignments x where x.job_id=j.id and x.slot=candidate and x.ended_at is null) order by candidate limit 1;
 if s is null then raise exception 'JOB_FULL';end if;
 insert into public.assignments(job_id,cleaner_id,slot,claimed_at) values(j.id,u.id,s,t);
 elsif p_action='withdraw' then
 if a.id is null then raise exception 'NOT_FOUND';end if;
 if not private.withdrawal_allowed(t,j.start_at) then raise exception 'WITHDRAWAL_DEADLINE';end if;
 update public.assignments set ended_at=t,end_reason='withdrawn' where id=a.id;
 elsif p_action='complete' then
 if a.id is null then raise exception 'NOT_FOUND';end if;
 if j.review_required then raise exception 'REVIEW_REQUIRED';end if;
 if t<j.start_at then raise exception 'INVALID_STATE';end if;
 if j.cleaning_config is null or exists(select 1 from jsonb_array_elements(j.cleaning_config->'rooms') room where not exists(select 1 from public.job_photos ph where ph.job_id=j.id and ph.state='ready' and ph.room_id=(room->>'id')::uuid)) then raise exception 'PHOTO_COVERAGE_REQUIRED';end if;
 select count(*) into n from public.assignments where job_id=j.id and ended_at is null;
 update public.assignments set completed_pay_cents=j.solo_rate_cents_snapshot/n where job_id=j.id and ended_at is null;
 update public.jobs set status='completed',completed_at=t,completed_by=u.id,version=version+1,updated_at=t where id=j.id;
 elsif p_action='cancel' then
 update public.assignments set ended_at=t,end_reason='cancelled' where job_id=j.id and ended_at is null;
 update public.jobs set status='cancelled',review_required=false where id=j.id;
 elsif p_action='reassign' then
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

-- Replace only the public dispatcher. No legacy endpoint may bypass per-room/supply checks.
create or replace function public.bloom_job_action(p_job uuid,p_action text,p_key text,p_expected_version integer default null,p_payload jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare pid uuid;r jsonb;b jsonb;begin
 if p_action='complete' then return private.complete_cleaning(p_job,p_payload,p_key);end if;
 if p_action in ('cancel','reassign','keep','reschedule') then
 perform private.require_actor('admin');select property_id into pid from public.jobs where id=p_job;
 perform 1 from public.properties where id=pid for update;end if;
 r:=private.job_action_v1(p_job,p_action,p_key,p_expected_version,p_payload);
 if p_action='cancel' and exists(select 1 from public.jobs where id=p_job and status='cancelled' and cancellation_origin is distinct from 'admin') then
 b:=private.job_snapshot(p_job);update public.jobs set cancellation_origin='admin' where id=p_job;perform private.audit(p_job,'admin_cancellation_origin',b,p_key,p_payload);end if;
 return r;end $$;
revoke all on function private.snapshot_cleaning_config(),private.complete_cleaning(uuid,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.bloom_cleaning_config(uuid,jsonb,text),public.bloom_job_journey(uuid),public.bloom_job_start(uuid,text),public.bloom_room_photo_prepare(uuid,uuid,text,integer,text) from public,anon;
grant execute on function public.bloom_cleaning_config(uuid,jsonb,text),public.bloom_job_journey(uuid),public.bloom_job_start(uuid,text),public.bloom_room_photo_prepare(uuid,uuid,text,integer,text) to authenticated;
commit;
