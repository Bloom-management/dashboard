begin;
create table public.job_maintenance_reports (
 job_id uuid not null references public.jobs,category text not null check(category in ('painting','fridge','electricity','wifi','tv','garage','climate','water')),
 status text not null check(status in ('ok','attention','not_applicable')),notes text not null check(length(notes)<=500 and (status<>'attention' or length(trim(notes))>0)),
 reported_by uuid not null references public.users,reported_at timestamptz not null,
 primary key(job_id,category)
);
alter table public.job_maintenance_reports enable row level security;
revoke all on public.job_maintenance_reports from public,anon,authenticated,service_role;
grant select on public.job_maintenance_reports to authenticated;
create policy maintenance_read on public.job_maintenance_reports for select to authenticated using(private.is_admin() or private.assigned(job_id));
create trigger maintenance_immutable before update or delete on public.job_maintenance_reports for each row execute function private.immutable();
create or replace function private.complete_cleaning(p_job uuid,p_payload jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
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
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('configVersion','answers','notes','maintenance'))
 or (p_payload->>'configVersion')::integer is distinct from (j.cleaning_config->>'version')::integer then raise exception 'CONFLICT';end if;
 if jsonb_typeof(p_payload->'answers') is distinct from 'array' or jsonb_typeof(p_payload->'notes') is distinct from 'string' or length(p_payload->>'notes')>1500 then raise exception 'VALIDATION_ERROR';end if;
 if jsonb_typeof(p_payload->'maintenance') is distinct from 'array' or jsonb_array_length(p_payload->'maintenance')<>8 then raise exception 'VALIDATION_ERROR';end if;
 for v in select value from jsonb_array_elements(p_payload->'maintenance') loop
 if jsonb_typeof(v)<>'object' or exists(select 1 from jsonb_object_keys(v) k where k not in ('category','status','notes'))
 or jsonb_typeof(v->'category') is distinct from 'string' or v->>'category' not in ('painting','fridge','electricity','wifi','tv','garage','climate','water')
 or jsonb_typeof(v->'status') is distinct from 'string' or v->>'status' not in ('ok','attention','not_applicable')
 or jsonb_typeof(v->'notes') is distinct from 'string' or length(v->>'notes')>500
 or (v->>'status'='attention' and length(trim(v->>'notes'))=0)
 or (select count(*) from jsonb_array_elements(p_payload->'maintenance') x where x->>'category'=v->>'category')<>1
 then raise exception 'VALIDATION_ERROR';end if;
 end loop;
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
 insert into public.job_maintenance_reports(job_id,category,status,notes,reported_by,reported_at)
 select p_job,x->>'category',x->>'status',trim(x->>'notes'),u.id,at_time from jsonb_array_elements(p_payload->'maintenance') x;
 -- Existing completion implementation retains pay, capacity, review, eligibility, and audit checks.
 r:=jsonb_build_object('jobId',p_job,'completedAt',at_time,'completedBy',u.id,'notes',p_payload->>'notes','maintenance',p_payload->'maintenance','reports',
 (select coalesce(jsonb_agg(jsonb_build_object('supplyId',supply_id,'name',name,'level',level)),'[]') from public.job_supply_reports where job_id=p_job));
 insert into public.admin_notification_events(job_id,event_type,payload) values(p_job,'job.completed',r) returning id into event_id;
 r:=r||jsonb_build_object('eventId',event_id);
 update public.jobs set completion_receipt=r where id=p_job;
 perform private.job_action_v1(p_job,'complete',p_key);
 return private.save_receipt('cleaning_complete',p_key,input,jsonb_build_object('job',private.job_dto(p_job),'receipt',r));end $$;

create or replace function public.bloom_job_journey(p_job uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u public.users;j public.jobs;reports jsonb;begin
 u:=private.require_actor();if u.role not in ('cleaner','admin') then raise exception 'FORBIDDEN';end if;select * into j from public.jobs where id=p_job;
 if j.id is null or (u.role<>'admin' and not private.assigned(p_job)) then raise exception 'NOT_FOUND';end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into reports from (
 select distinct on (r.supply_id) r.supply_id as "supplyId",r.level,r.reported_at as "reportedAt"
 from public.job_supply_reports r join public.jobs other on other.id=r.job_id where other.property_id=j.property_id
 order by r.supply_id,r.reported_at desc,r.job_id desc) x;
 return jsonb_build_object('job',private.job_dto(p_job),'config',coalesce(j.cleaning_config,(select cleaning_config from public.properties where id=j.property_id)),
 'startedAt',j.started_at,'startedBy',j.started_by,'previousReports',reports,'previousMaintenance',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from
 (select distinct on (m.category) m.category,m.status,m.notes,m.reported_at as "reportedAt" from public.job_maintenance_reports m join public.jobs other on other.id=m.job_id where other.property_id=j.property_id and other.status='completed' order by m.category,m.reported_at desc,m.job_id desc) x),'receipt',j.completion_receipt);
 end $$;


-- Keep the established owner projection/authorization and add only safe condition data.
alter function public.bloom_owner_listings(uuid) set schema private;
revoke all on function private.bloom_owner_listings(uuid) from public,anon,authenticated,service_role;
create function public.bloom_owner_listings(p_cursor uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 result:=private.bloom_owner_listings(p_cursor);
 return jsonb_set(result,'{items}',coalesce((select jsonb_agg(item||jsonb_build_object('maintenance',
 (select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from
 (select distinct on (m.category) m.category,m.status,m.notes,m.reported_at as "reportedAt" from public.job_maintenance_reports m join public.jobs j on j.id=m.job_id where j.property_id=(item->>'id')::uuid and j.status='completed' order by m.category,m.reported_at desc,m.job_id desc)x)) order by ordinal)
 from jsonb_array_elements(result->'items') with ordinality a(item,ordinal)),'[]'::jsonb));
end $$;
revoke all on function public.bloom_owner_listings(uuid) from public,anon;
grant execute on function public.bloom_owner_listings(uuid) to authenticated;

-- Safe supply preview for eligible cleaners before claiming; no access instructions.
create function public.bloom_job_supplies(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u public.users;j public.jobs;p public.properties;begin
 u:=private.require_actor();if u.role not in ('cleaner','admin') then raise exception 'FORBIDDEN';end if;
 select * into j from public.jobs where id=p_job;select * into p from public.properties where id=j.property_id;
 if j.id is null or p.deleted_at is not null or (u.role<>'admin' and not private.assigned(p_job) and (j.status<>'open' or j.setup_required or not p.active or p.city_id is distinct from u.approved_city_id)) then raise exception 'NOT_FOUND';end if;
 return jsonb_build_object('supplies',coalesce(j.cleaning_config->'supplies',p.cleaning_config->'supplies','[]'::jsonb),
 'reports',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from
 (select distinct on (r.supply_id) r.supply_id as "supplyId",r.level,r.reported_at as "reportedAt" from public.job_supply_reports r join public.jobs old on old.id=r.job_id where old.property_id=p.id and old.status='completed' order by r.supply_id,r.reported_at desc,r.job_id desc)x));
end $$;
revoke all on function public.bloom_job_supplies(uuid) from public,anon;
grant execute on function public.bloom_job_supplies(uuid) to authenticated;
commit;
