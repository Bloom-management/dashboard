begin;
alter table public.calendar_sources add column fingerprint text, add column url_digest text,
 add column active_run_id uuid, add column lease_expires_at timestamptz,
 add column last_attempt_at timestamptz, add column last_error_code text;
-- Legacy draft rows remain readable but must be replaced through the approved setup RPC
-- before syncing: fabricated fingerprints are not inferred from encrypted credentials.
create unique index calendar_source_identity on public.calendar_sources(property_id,provider,fingerprint);
alter table public.calendar_sync_runs drop constraint calendar_sync_runs_status_check;
alter table public.calendar_sync_runs add constraint calendar_sync_runs_status_check check(status in ('running','success','partial','failed','not_modified'));
alter table public.calendar_sync_runs add column actor_id uuid references public.users,
 add column lease_version bigint, add column lease_expires_at timestamptz,
 add column finish_hash text, add column result jsonb;
alter table public.calendar_sources add constraint source_active_run foreign key(active_run_id) references public.calendar_sync_runs;
alter table public.calendar_events add column evidence text not null default 'unverified' check(evidence in ('airbnb-reservation-link','observed-block','unverified')),
 add column review_required boolean not null default false,
 add column event_status text not null default 'active' check(event_status in ('active','cancelled')),
 add column missing_reason text check(missing_reason='horizon_unknown'),
 add column transition_version bigint not null default 1;
alter table public.calendar_changes add column transition_version bigint,
 add column notice_key text;
create unique index calendar_notice_identity on public.calendar_changes(event_id,transition_version,notice_key);
alter table public.jobs add column cancellation_origin text check(cancellation_origin in ('admin','calendar'));
create table public.calendar_operation_receipts (
 actor_key text not null,operation text not null,idempotency_key text not null,
 input_hash text not null,run_id uuid references public.calendar_sync_runs,result jsonb,
 created_at timestamptz not null default now(),primary key(actor_key,operation,idempotency_key)
);
create table public.job_event_history (
 id uuid primary key default gen_random_uuid(),job_id uuid not null references public.jobs,event_id uuid not null references public.calendar_events,
 run_id uuid not null references public.calendar_sync_runs,actor_id uuid references public.users,
 action text not null check(action in ('linked','unlinked','observed_protected')),
 event_version bigint not null,created_at timestamptz not null default now(),
 unique(job_id,event_id,run_id,action)
);
create trigger link_history_immutable before update or delete on public.job_event_history for each row execute function private.immutable();
alter table public.calendar_operation_receipts enable row level security;
alter table public.job_event_history enable row level security;
revoke all on public.calendar_sources,public.calendar_sync_runs,public.calendar_events,public.calendar_event_history,
 public.calendar_changes,public.job_events,public.calendar_operation_receipts,public.job_event_history from public,anon,authenticated,service_role;

create function private.calendar_error(p_code text) returns void language plpgsql set search_path='' as $$ begin
 raise exception using message=p_code,errcode=case p_code when 'FORBIDDEN' then 'PT403' when 'NOT_FOUND' then 'PT404' when 'CONFLICT' then 'PT409' when 'CONFIGURATION_ERROR' then 'PT503' else 'PT400' end;
end $$;
create function private.calendar_actor(p_actor uuid,p_require_admin boolean default false) returns text language plpgsql stable security definer set search_path='' as $$ begin
 if auth.role() is distinct from 'service_role' or current_setting('role',true) is distinct from 'service_role' then perform private.calendar_error('FORBIDDEN');end if;
 if (p_require_admin and p_actor is null) or (p_actor is not null and not exists(select 1 from public.users where id=p_actor and role='admin')) then perform private.calendar_error('FORBIDDEN');end if;
 return coalesce(p_actor::text,'scheduler');end $$;
create function private.calendar_hash(p_value jsonb) returns text language sql immutable set search_path='' as $$ select encode(sha256(convert_to(p_value::text,'UTF8')),'hex') $$;
create function private.calendar_key(p_actor_key text,p_operation text,p_key text) returns void language plpgsql set search_path='' as $$ begin
 if p_key is null or length(p_key) not between 1 and 200 or p_key ~ '[[:cntrl:]]' then perform private.calendar_error('VALIDATION_ERROR');end if;
 perform pg_advisory_xact_lock(hashtextextended('calendar:'||p_actor_key||':'||p_operation||':'||p_key,0));end $$;
create function private.calendar_object(p_value jsonb,p_keys text[]) returns void language plpgsql immutable set search_path='' as $$ begin
 if jsonb_typeof(p_value) is distinct from 'object' then perform private.calendar_error('VALIDATION_ERROR');end if;
 if exists(select 1 from jsonb_object_keys(p_value) k where not k=any(p_keys)) then perform private.calendar_error('VALIDATION_ERROR');end if;end $$;
create function private.calendar_text(p_value jsonb,p_min integer,p_max integer) returns text language plpgsql immutable set search_path='' as $$ declare t text;begin
 if jsonb_typeof(p_value) is distinct from 'string' then perform private.calendar_error('VALIDATION_ERROR');end if;
 t:=p_value#>>'{}';if length(t) not between p_min and p_max or t ~ '[[:cntrl:]]' then perform private.calendar_error('VALIDATION_ERROR');end if;return t;end $$;
create function private.calendar_date(p_value jsonb) returns date language plpgsql immutable set search_path='' as $$ declare t text;d date;begin
 t:=private.calendar_text(p_value,10,10);
 if t !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then perform private.calendar_error('VALIDATION_ERROR');end if;
 begin d:=t::date;exception when others then perform private.calendar_error('VALIDATION_ERROR');end;
 if not isfinite(d) or to_char(d,'YYYY-MM-DD')<>t then perform private.calendar_error('VALIDATION_ERROR');end if;return d;end $$;
create function private.calendar_property(p_source uuid) returns public.properties language plpgsql security definer set search_path='' as $$ declare p public.properties;pid uuid;begin
 select property_id into pid from public.calendar_sources where id=p_source;
 if pid is null then perform private.calendar_error('NOT_FOUND');end if;
 select * into p from public.properties where id=pid for update;
 if not found then perform private.calendar_error('NOT_FOUND');end if;
 return p;end $$;
create function private.calendar_health(p_source uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'propertyId',property_id,'provider',provider,'enabled',enabled,'lastSuccessAt',last_success_at,'lastAttemptAt',last_attempt_at,'errorCode',last_error_code,'action',null) from public.calendar_sources where id=p_source
$$;
create function private.calendar_lease(p_source uuid,p_run uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('runId',p_run,'version',s.sync_version,'source',jsonb_strip_nulls(jsonb_build_object('id',s.id,'propertyId',s.property_id,'provider',s.provider,'encryptedUrl',s.encrypted_url,'timezone',p.timezone,'enabled',s.enabled,'syncVersion',s.sync_version,'etag',s.etag,'lastModified',s.last_modified)))
 from public.calendar_sources s join public.properties p on p.id=s.property_id where s.id=p_source
$$;
create function public.bloom_calendar_add_source(p_actor uuid,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor_key text;pid uuid;prov text;fp text;dig text;cipher text;p public.properties;s public.calendar_sources;r public.calendar_operation_receipts;h text;result jsonb;begin
 v_actor_key:=private.calendar_actor(p_actor,true);
 perform private.calendar_object(p_input,array['propertyId','provider','encryptedUrl','fingerprint','urlDigest']);
 begin pid:=private.calendar_text(p_input->'propertyId',36,36)::uuid;exception when others then perform private.calendar_error('VALIDATION_ERROR');end;
 prov:=private.calendar_text(p_input->'provider',4,6);fp:=private.calendar_text(p_input->'fingerprint',64,64);dig:=private.calendar_text(p_input->'urlDigest',64,64);cipher:=private.calendar_text(p_input->'encryptedUrl',40,16384);
 if prov not in ('airbnb','vrbo') or fp !~ '^[a-f0-9]{64}$' or dig !~ '^[a-f0-9]{64}$' or cipher !~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$' then perform private.calendar_error('VALIDATION_ERROR');end if;
 select * into p from public.properties where id=pid for update;
 if not found then perform private.calendar_error('NOT_FOUND');end if;
 if not p.active or not exists(select 1 from pg_timezone_names where name=p.timezone) then perform private.calendar_error('VALIDATION_ERROR');end if;
 perform private.calendar_key(v_actor_key,'add_source',p_key);
 h:=private.calendar_hash(p_input-'encryptedUrl');
 select * into r from public.calendar_operation_receipts cr where cr.actor_key=v_actor_key and operation='add_source' and idempotency_key=p_key;
 if found then if r.input_hash<>h then perform private.calendar_error('CONFLICT');end if;return r.result;end if;
 select * into s from public.calendar_sources where property_id=pid and provider=prov and fingerprint=fp for update;
 if not found then
 insert into public.calendar_sources(property_id,provider,encrypted_url,fingerprint,url_digest) values(pid,prov,cipher,fp,dig) returning * into s;
 elsif s.url_digest<>dig then
 if s.active_run_id is not null then update public.calendar_sync_runs set status='failed',error_code='SYNC_FAILED',completed_at=clock_timestamp() where id=s.active_run_id and status='running';end if;
 update public.calendar_sources set encrypted_url=cipher,url_digest=dig,sync_version=sync_version+1,active_run_id=null,lease_expires_at=null,etag=null,last_modified=null,updated_at=clock_timestamp() where id=s.id;
 end if;
 result:=private.calendar_health(s.id);
 insert into public.calendar_operation_receipts(actor_key,operation,idempotency_key,input_hash,result) values(v_actor_key,'add_source',p_key,h,result);return result;
end $$;
create function public.bloom_calendar_sources(p_actor uuid,p_cursor uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 perform private.calendar_actor(p_actor,true);
 return (select jsonb_build_object('items',coalesce(jsonb_agg(private.calendar_health(id) order by id) filter(where rn<=100),'[]'),'nextCursor',case when count(*)>100 then (array_agg(id order by id))[100] else null end)
 from (select id,row_number() over(order by id) rn from public.calendar_sources where p_cursor is null or id>p_cursor order by id limit 101) page);end $$;
create function public.bloom_calendar_enabled_sources(p_actor uuid,p_cursor uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 perform private.calendar_actor(p_actor);
 return (select jsonb_build_object('ids',coalesce(jsonb_agg(id order by id) filter(where rn<=100),'[]'),'nextCursor',case when count(*)>100 then (array_agg(id order by id))[100] else null end)
 from (select id,row_number() over(order by id) rn from public.calendar_sources where enabled and (p_cursor is null or id>p_cursor) order by id limit 101) page);end $$;
create function public.bloom_calendar_begin_sync(p_actor uuid,p_source uuid,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor_key text;p public.properties;s public.calendar_sources;r public.calendar_operation_receipts;run public.calendar_sync_runs;h text;t timestamptz;begin
 v_actor_key:=private.calendar_actor(p_actor);p:=private.calendar_property(p_source);
 select * into s from public.calendar_sources where id=p_source for update;
 perform private.calendar_key(v_actor_key,'begin_sync',p_key);
 h:=private.calendar_hash(jsonb_build_object('source',p_source));
 select * into r from public.calendar_operation_receipts cr where cr.actor_key=v_actor_key and operation='begin_sync' and idempotency_key=p_key;
 if found then
 if r.input_hash<>h then perform private.calendar_error('CONFLICT');end if;
 select * into run from public.calendar_sync_runs where id=r.run_id;
 if run.result is not null then return jsonb_build_object('result',run.result);end if;
 if run.status='running' and s.active_run_id=run.id and s.sync_version=run.lease_version and s.lease_expires_at>clock_timestamp() then return private.calendar_lease(s.id,run.id);end if;
 perform private.calendar_error('CONFLICT');end if;
 t:=clock_timestamp();
 if not s.enabled or not p.active then perform private.calendar_error('CONFLICT');end if;
 if s.fingerprint is null or s.url_digest is null or not exists(select 1 from pg_timezone_names where name=p.timezone) then perform private.calendar_error('CONFIGURATION_ERROR');end if;
 if s.active_run_id is not null and s.lease_expires_at>t then perform private.calendar_error('CONFLICT');end if;
 if s.active_run_id is not null then update public.calendar_sync_runs set status='failed',error_code='SYNC_FAILED',completed_at=t where id=s.active_run_id and status='running';end if;
 insert into public.calendar_sync_runs(source_id,status,actor_id,lease_version,lease_expires_at) values(s.id,'running',p_actor,s.sync_version+1,t+interval '60 seconds') returning * into run;
 update public.calendar_sources set sync_version=run.lease_version,active_run_id=run.id,lease_expires_at=run.lease_expires_at,last_attempt_at=t,updated_at=t where id=s.id;
 insert into public.calendar_operation_receipts(actor_key,operation,idempotency_key,input_hash,run_id) values(v_actor_key,'begin_sync',p_key,h,run.id);
 return private.calendar_lease(s.id,run.id);end $$;
create function public.bloom_calendar_fail_sync(p_actor uuid,p_source uuid,p_run uuid,p_version bigint,p_code text) returns void language plpgsql security definer set search_path='' as $$
declare p public.properties;s public.calendar_sources;r public.calendar_sync_runs;begin
 perform private.calendar_actor(p_actor);p:=private.calendar_property(p_source);
 select * into s from public.calendar_sources where id=p_source for update;
 select * into r from public.calendar_sync_runs where id=p_run and source_id=p_source;
 if not found or r.actor_id is distinct from p_actor then perform private.calendar_error('FORBIDDEN');end if;
 if p_code is null or p_code not in ('FETCH_TIMEOUT','FETCH_FAILED','FETCH_HTTP','UNSAFE_URL','UNSAFE_ADDRESS','FETCH_TOO_LARGE','INVALID_CALENDAR','PARTIAL_CALENDAR','CONFIGURATION_ERROR','SYNC_FAILED') then perform private.calendar_error('VALIDATION_ERROR');end if;
 if s.active_run_id is distinct from p_run or s.sync_version is distinct from p_version or r.lease_version is distinct from p_version or s.lease_expires_at<=clock_timestamp() or r.status<>'running' then return;end if;
 update public.calendar_sync_runs set status='failed',error_code=p_code,completed_at=clock_timestamp() where id=p_run;
 update public.calendar_sources set active_run_id=null,lease_expires_at=null,last_error_code=p_code,updated_at=clock_timestamp() where id=p_source;
end $$;
create function private.calendar_guard_identity() returns trigger language plpgsql set search_path='' as $$ begin
 if new.property_id is distinct from old.property_id then perform private.calendar_error('CONFLICT');end if;
 if TG_TABLE_NAME='calendar_sources' and (to_jsonb(new)->'provider' is distinct from to_jsonb(old)->'provider' or to_jsonb(new)->'fingerprint' is distinct from to_jsonb(old)->'fingerprint') then perform private.calendar_error('CONFLICT');end if;
 return new;end $$;
create trigger calendar_source_identity_immutable before update on public.calendar_sources for each row execute function private.calendar_guard_identity();
create trigger job_property_immutable before update on public.jobs for each row execute function private.calendar_guard_identity();
-- Admin paths enter the same property-first lock order. The original implementation remains
-- private; no old public overload can bypass the wrapper.
alter function public.bloom_job_action(uuid,text,text,integer,jsonb) set schema private;
alter function private.bloom_job_action(uuid,text,text,integer,jsonb) rename to job_action_v1;
revoke all on function private.job_action_v1(uuid,text,text,integer,jsonb) from public,anon,authenticated,service_role;
create function public.bloom_job_action(p_job uuid,p_action text,p_key text,p_expected_version integer default null,p_payload jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare pid uuid;r jsonb;b jsonb;begin
 if p_action in ('cancel','reassign','keep','reschedule') then
 perform private.require_actor('admin');select property_id into pid from public.jobs where id=p_job;
 perform 1 from public.properties where id=pid for update;
 end if;
 r:=private.job_action_v1(p_job,p_action,p_key,p_expected_version,p_payload);
 if p_action='cancel' and exists(select 1 from public.jobs where id=p_job and status='cancelled' and cancellation_origin is distinct from 'admin') then
 b:=private.job_snapshot(p_job);update public.jobs set cancellation_origin='admin' where id=p_job;
 perform private.audit(p_job,'admin_cancellation_origin',b,p_key,p_payload);
 end if;
 return r;
 exception when unique_violation then perform private.calendar_error('CONFLICT');
 end $$;
revoke all on function public.bloom_job_action(uuid,text,text,integer,jsonb) from public,anon;
grant execute on function public.bloom_job_action(uuid,text,text,integer,jsonb) to authenticated;
-- Only the API service role may execute calendar RPCs; helpers remain unexposed.
revoke all on function public.bloom_calendar_add_source(uuid,jsonb,text),public.bloom_calendar_sources(uuid,uuid),public.bloom_calendar_enabled_sources(uuid,uuid),public.bloom_calendar_begin_sync(uuid,uuid,text),public.bloom_calendar_fail_sync(uuid,uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.bloom_calendar_add_source(uuid,jsonb,text),public.bloom_calendar_sources(uuid,uuid),public.bloom_calendar_enabled_sources(uuid,uuid),public.bloom_calendar_begin_sync(uuid,uuid,text),public.bloom_calendar_fail_sync(uuid,uuid,uuid,bigint,text) to service_role;
do $$ declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'calendar_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;end $$;
commit;
