begin;
-- These owner ports never broaden the administrator/scheduler actor helper.
create function private.owner_calendar_property(p_actor uuid,p_property uuid,p_source uuid default null)
returns public.properties language plpgsql security definer set search_path='' as $$
declare p public.properties;begin
 if auth.role() is distinct from 'service_role' or current_setting('role',true) is distinct from 'service_role' or p_actor is null then perform private.calendar_error('FORBIDDEN');end if;
 select * into p from public.properties where id=p_property for update;
 if not found then perform private.calendar_error('NOT_FOUND');end if;
 perform 1 from public.users where id=p_actor and role='owner' for share;
 if not found then perform private.calendar_error('FORBIDDEN');end if;
 perform 1 from public.property_owners where property_id=p_property and owner_id=p_actor for share;
 if not found then perform private.calendar_error('NOT_FOUND');end if;
 if p_source is not null and not exists(select 1 from public.calendar_sources where id=p_source and property_id=p_property and provider='airbnb') then perform private.calendar_error('NOT_FOUND');end if;
 return p;
end $$;
revoke all on function private.owner_calendar_property(uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function public.bloom_owner_calendar_add_source(p_actor uuid,p_property uuid,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor_key text;pid uuid;prov text;fp text;dig text;cipher text;p public.properties;s public.calendar_sources;r public.calendar_operation_receipts;h text;result jsonb;begin
 p:=private.owner_calendar_property(p_actor,p_property);v_actor_key:=p_actor::text;
 perform private.calendar_object(p_input,array['propertyId','provider','encryptedUrl','fingerprint','urlDigest']);
 begin pid:=private.calendar_text(p_input->'propertyId',36,36)::uuid;exception when others then perform private.calendar_error('VALIDATION_ERROR');end;
 prov:=private.calendar_text(p_input->'provider',4,6);fp:=private.calendar_text(p_input->'fingerprint',64,64);dig:=private.calendar_text(p_input->'urlDigest',64,64);cipher:=private.calendar_text(p_input->'encryptedUrl',40,16384);
 if pid is distinct from p_property or prov<>'airbnb' or fp !~ '^[a-f0-9]{64}$' or dig !~ '^[a-f0-9]{64}$' or cipher !~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$' then perform private.calendar_error('VALIDATION_ERROR');end if;

 if not p.active or not exists(select 1 from pg_timezone_names where name=p.timezone) then perform private.calendar_error('VALIDATION_ERROR');end if;
 if exists(select 1 from public.calendar_sources where property_id=p_property and provider='airbnb' and fingerprint is distinct from fp) then perform private.calendar_error('CONFLICT');end if;
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
create function public.bloom_owner_calendar_begin_sync(p_actor uuid,p_property uuid,p_source uuid,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor_key text;p public.properties;s public.calendar_sources;r public.calendar_operation_receipts;run public.calendar_sync_runs;h text;t timestamptz;begin
 p:=private.owner_calendar_property(p_actor,p_property,p_source);v_actor_key:=p_actor::text;
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
create function public.bloom_owner_calendar_finish_sync(p_actor uuid,p_property uuid,p_source uuid,p_run uuid,p_version bigint,p_snapshot jsonb,p_validators jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.properties;s public.calendar_sources;r public.calendar_sync_runs;h text;v_result jsonb;outcome text;v text;begin
 p:=private.owner_calendar_property(p_actor,p_property,p_source);
 select * into s from public.calendar_sources where id=p_source for update;
 select * into r from public.calendar_sync_runs where id=p_run and source_id=p_source;
 if not found or r.actor_id is distinct from p_actor then perform private.calendar_error('FORBIDDEN');end if;
 perform private.calendar_object(p_validators,array['etag','lastModified']);
 if p_validators ? 'etag' then v:=private.calendar_text(p_validators->'etag',1,1024);end if;
 if p_validators ? 'lastModified' then v:=private.calendar_text(p_validators->'lastModified',1,1024);end if;
 h:=private.calendar_hash(jsonb_build_object('snapshot',p_snapshot,'validators',p_validators));
 if r.result is not null then
 if r.finish_hash is distinct from h or r.lease_version is distinct from p_version then perform private.calendar_error('CONFLICT');end if;return r.result;end if;
 if s.active_run_id is distinct from p_run or s.sync_version is distinct from p_version or r.lease_version is distinct from p_version or s.lease_expires_at<=clock_timestamp() or r.status<>'running' or not s.enabled then perform private.calendar_error('CONFLICT');end if;
 if p_snapshot is not null then perform private.calendar_validate_snapshot(p_snapshot,s.provider);end if;
 -- Deterministic property/source/jobs lock order, shared with the admin wrapper.
 perform 1 from public.jobs where property_id=p.id order by id for update;
 if s.lease_expires_at<=clock_timestamp() then perform private.calendar_error('CONFLICT');end if;
 v_result:=jsonb_build_object('runId',p_run,'created',0,'updated',0,'removed',0,'unchanged',0,'conflicts',0);
 if p_snapshot is null then
 if s.etag is null and s.last_modified is null then perform private.calendar_error('VALIDATION_ERROR');end if;
 outcome:='not_modified';
 elsif not (p_snapshot->>'complete')::boolean then outcome:='partial';
 else
 if not p.active or not exists(select 1 from pg_timezone_names where name=p.timezone) then perform private.calendar_error('VALIDATION_ERROR');end if;
 v_result:=private.calendar_apply(p_source,p_run,p_actor,p_snapshot);outcome:='success';end if;
 if s.lease_expires_at<=clock_timestamp() then perform private.calendar_error('CONFLICT');end if;
 v_result:=v_result||jsonb_build_object('status',outcome);
 update public.calendar_sync_runs set status=outcome,counts=(v_result-'runId'-'status')||case when outcome='partial' then jsonb_build_object('issues',jsonb_array_length(p_snapshot->'issues')) else '{}'::jsonb end,
 error_code=case when outcome='partial' then 'PARTIAL_CALENDAR' end,finish_hash=h,result=v_result,completed_at=clock_timestamp() where id=p_run;
 update public.calendar_sources set active_run_id=null,lease_expires_at=null,
 last_success_at=case when outcome='partial' then last_success_at else clock_timestamp() end,
 last_error_code=case when outcome='partial' then 'PARTIAL_CALENDAR' end,
 etag=case when outcome='success' then p_validators->>'etag' else etag end,
 last_modified=case when outcome='success' then p_validators->>'lastModified' else last_modified end,updated_at=clock_timestamp() where id=p_source;
 return v_result;
end $$;
create function public.bloom_owner_calendar_fail_sync(p_actor uuid,p_property uuid,p_source uuid,p_run uuid,p_version bigint,p_code text) returns void language plpgsql security definer set search_path='' as $$
declare p public.properties;s public.calendar_sources;r public.calendar_sync_runs;begin
 p:=private.owner_calendar_property(p_actor,p_property,p_source);
 select * into s from public.calendar_sources where id=p_source for update;
 select * into r from public.calendar_sync_runs where id=p_run and source_id=p_source;
 if not found or r.actor_id is distinct from p_actor then perform private.calendar_error('FORBIDDEN');end if;
 if p_code is null or p_code not in ('FETCH_TIMEOUT','FETCH_FAILED','FETCH_HTTP','UNSAFE_URL','UNSAFE_ADDRESS','FETCH_TOO_LARGE','INVALID_CALENDAR','PARTIAL_CALENDAR','CONFIGURATION_ERROR','SYNC_FAILED') then perform private.calendar_error('VALIDATION_ERROR');end if;
 if s.active_run_id is distinct from p_run or s.sync_version is distinct from p_version or r.lease_version is distinct from p_version or s.lease_expires_at<=clock_timestamp() or r.status<>'running' then return;end if;
 update public.calendar_sync_runs set status='failed',error_code=p_code,completed_at=clock_timestamp() where id=p_run;
 update public.calendar_sources set active_run_id=null,lease_expires_at=null,last_error_code=p_code,updated_at=clock_timestamp() where id=p_source;
end $$;
create function public.bloom_owner_calendar_sources(p_actor uuid,p_property uuid,p_cursor uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$ begin
 perform private.owner_calendar_property(p_actor,p_property);
 return (select jsonb_build_object('items',coalesce(jsonb_agg(private.calendar_health(id) order by id) filter(where rn<=100),'[]'),'nextCursor',case when count(*)>100 then (array_agg(id order by id))[100] else null end)
 from (select id,row_number() over(order by id) rn from public.calendar_sources where property_id=p_property and (p_cursor is null or id>p_cursor) order by id limit 101) page);
end $$;
revoke all on function public.bloom_owner_calendar_add_source(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.bloom_owner_calendar_add_source(uuid,uuid,jsonb,text) to service_role;
revoke all on function public.bloom_owner_calendar_begin_sync(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.bloom_owner_calendar_begin_sync(uuid,uuid,uuid,text) to service_role;
revoke all on function public.bloom_owner_calendar_finish_sync(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.bloom_owner_calendar_finish_sync(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb) to service_role;
revoke all on function public.bloom_owner_calendar_fail_sync(uuid,uuid,uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.bloom_owner_calendar_fail_sync(uuid,uuid,uuid,uuid,bigint,text) to service_role;
revoke all on function public.bloom_owner_calendar_sources(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.bloom_owner_calendar_sources(uuid,uuid,uuid) to service_role;
-- Explicit owner-safe source projection; error internals never leave the database.
create function private.owner_source(p_source uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',s.id,'propertyId',s.property_id,'provider',s.provider,'enabled',s.enabled,
 'lastSuccessAt',s.last_success_at,'lastAttemptAt',s.last_attempt_at,
 'message',case when not s.enabled then 'Calendar source disabled.' when s.last_error_code is not null then 'Calendar update needs attention.' when s.last_success_at is null then 'Calendar has not been checked.' else 'Calendar checked successfully.' end)
 from public.calendar_sources s where s.id=p_source
$$;
revoke all on function private.owner_source(uuid) from public,anon,authenticated,service_role;
create function public.bloom_owner_listings(p_cursor uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u public.users;r jsonb;begin
 u:=private.require_actor('owner');
 with page as (select p.* from public.properties p join public.property_owners po on po.property_id=p.id where po.owner_id=u.id and (p_cursor is null or p.id>p_cursor) order by p.id limit 101),
 shown as (select * from page order by id limit 100)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
 'id',p.id,'name',p.name,'timezone',p.timezone,'active',p.active,'nightlyGuestRateCents',null,'hostPayoutCents',null,'currency','USD',
 'supplies',coalesce((select jsonb_agg(jsonb_build_object('supplyId',c.value->>'id','name',c.value->>'name','level',r.level,'reportedAt',r.reported_at) order by c.ordinality)
 from jsonb_array_elements(coalesce(p.cleaning_config->'supplies','[]'::jsonb)) with ordinality c(value,ordinality)
 left join lateral (select x.level,x.reported_at from public.job_supply_reports x join public.jobs j on j.id=x.job_id
 where j.property_id=p.id and j.status='completed' and x.supply_id=(c.value->>'id')::uuid order by j.completed_at desc,x.reported_at desc,j.id desc limit 1) r on true),'[]'::jsonb),
 'sources',coalesce((select jsonb_agg(private.owner_source(s.id) order by s.id) from public.calendar_sources s where s.property_id=p.id),'[]'::jsonb)
 ) order by p.id) from shown p),'[]'::jsonb),
 'nextCursor',case when (select count(*) from page)>100 then (select max(id::text) from shown) else null end) into r;
 return r;
end $$;
create function public.bloom_owner_analytics(p_from date,p_to_exclusive date,p_properties uuid[] default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u public.users;ids uuid[];r jsonb;begin
 u:=private.require_actor('owner');
 if p_from is null or p_to_exclusive is null or not isfinite(p_from) or not isfinite(p_to_exclusive) or p_to_exclusive-p_from not between 1 and 366
 or (p_properties is not null and (cardinality(p_properties)>100 or array_position(p_properties,null) is not null)) then raise exception 'VALIDATION_ERROR';end if;
 if p_properties is not null and exists(select 1 from unnest(p_properties) x where not exists(select 1 from public.property_owners po where po.property_id=x and po.owner_id=u.id)) then raise exception 'NOT_FOUND';end if;
 select coalesce(array_agg(p.id order by p.id),'{}'::uuid[]) into ids from public.properties p join public.property_owners po on po.property_id=p.id where po.owner_id=u.id and (p_properties is null or p.id=any(p_properties));
 -- An oversized portfolio must be explicitly narrowed, never silently truncated.
 if cardinality(ids)>100 then raise exception 'VALIDATION_ERROR';end if;
 if (select count(*) from public.calendar_events e join public.calendar_sources s on s.id=e.source_id where s.property_id=any(ids) and e.start_local_date<p_to_exclusive and (e.end_local_date>p_from or e.start_local_date>=p_from))>50000 then raise exception 'VALIDATION_ERROR';end if;
 select jsonb_build_object('properties',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'timezone',p.timezone,'coverage','[]'::jsonb) order by p.id) from public.properties p where p.id=any(ids)),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'propertyId',s.property_id,'startDate',e.start_local_date,'endDate',e.end_local_date,'kind',e.kind,
 'removed',e.source_status='removed','confirmed',e.kind='reservation' and e.evidence='airbnb-reservation-link' and not e.review_required,
 'origin',case when e.kind='reservation' and e.evidence='airbnb-reservation-link' and not e.review_required then 'airbnb' else 'unknown' end) order by e.id)
 from public.calendar_events e join public.calendar_sources s on s.id=e.source_id where s.property_id=any(ids) and e.start_local_date<p_to_exclusive and (e.end_local_date>p_from or e.start_local_date>=p_from)),'[]'::jsonb)) into r;
 return r;
end $$;
revoke all on function public.bloom_owner_listings(uuid),public.bloom_owner_analytics(date,date,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.bloom_owner_listings(uuid),public.bloom_owner_analytics(date,date,uuid[]) to authenticated;
commit;
