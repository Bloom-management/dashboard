begin;
-- Deliberate product gate. Main must relay the blocked/unknown decision before this
-- function is changed in a later owned migration. No review-only policy is assumed.
create function private.calendar_cleaning_policy() returns text language sql immutable set search_path='' as $$ select 'pending'::text $$;
create function private.calendar_validate_snapshot(p_snapshot jsonb,p_provider text) returns void language plpgsql immutable set search_path='' as $$
declare e jsonb;issue jsonb;v text;start_date date;end_date date;begin
 perform private.calendar_object(p_snapshot,array['events','issues','complete','coverage']);
 if jsonb_typeof(p_snapshot->'complete') is distinct from 'boolean' or p_snapshot->'coverage' is distinct from 'null'::jsonb
 or jsonb_typeof(p_snapshot->'events') is distinct from 'array' or jsonb_typeof(p_snapshot->'issues') is distinct from 'array'
 or octet_length(p_snapshot::text)>8388608 then perform private.calendar_error('VALIDATION_ERROR');end if;
 if jsonb_array_length(p_snapshot->'events')>5000 or jsonb_array_length(p_snapshot->'issues')>5000 or ((p_snapshot->>'complete')::boolean and jsonb_array_length(p_snapshot->'issues')>0) then perform private.calendar_error('VALIDATION_ERROR');end if;
 if exists(select 1 from jsonb_array_elements(p_snapshot->'events') x group by x->>'uid',x->>'recurrenceKey' having count(*)>1) then perform private.calendar_error('VALIDATION_ERROR');end if;
 for e in select value from jsonb_array_elements(p_snapshot->'events') loop
 perform private.calendar_object(e,array['uid','recurrenceKey','startDate','endDate','kind','contentHash','status','evidence','reviewRequired']);
 v:=private.calendar_text(e->'uid',1,1024);if trim(v)='' then perform private.calendar_error('VALIDATION_ERROR');end if;
 v:=private.calendar_text(e->'recurrenceKey',0,40);
 if v<>'' then
 if length(v)=10 then perform private.calendar_date(to_jsonb(v));
 elsif v ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$' then
 perform private.calendar_date(to_jsonb(left(v,10)));begin if not isfinite(v::timestamptz) then perform private.calendar_error('VALIDATION_ERROR');end if;exception when others then perform private.calendar_error('VALIDATION_ERROR');end;
 else perform private.calendar_error('VALIDATION_ERROR');end if;end if;
 start_date:=private.calendar_date(e->'startDate');end_date:=private.calendar_date(e->'endDate');
 if end_date<start_date then perform private.calendar_error('VALIDATION_ERROR');end if;
 if private.calendar_text(e->'kind',7,11) not in ('reservation','blocked','unknown') or private.calendar_text(e->'status',6,9) not in ('active','cancelled')
 or private.calendar_text(e->'evidence',10,30) not in ('airbnb-reservation-link','observed-block','unverified')
 or private.calendar_text(e->'contentHash',64,64) !~ '^[a-f0-9]{64}$' or jsonb_typeof(e->'reviewRequired') is distinct from 'boolean' then perform private.calendar_error('VALIDATION_ERROR');end if;
 if (e->>'evidence'='airbnb-reservation-link' and p_provider<>'airbnb') or (e->>'evidence'='observed-block' and p_provider<>'vrbo') then perform private.calendar_error('VALIDATION_ERROR');end if;
 end loop;
 for issue in select value from jsonb_array_elements(p_snapshot->'issues') loop
 perform private.calendar_object(issue,array['code','eventKey']);
 if private.calendar_text(issue->'code',1,64) !~ '^[A-Z_]+$' then perform private.calendar_error('VALIDATION_ERROR');end if;
 if issue ? 'eventKey' and private.calendar_text(issue->'eventKey',64,64) !~ '^[a-f0-9]{64}$' then perform private.calendar_error('VALIDATION_ERROR');end if;
 end loop;
end $$;
create function private.calendar_event_value(e public.calendar_events) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('uid',e.uid,'recurrenceKey',e.recurrence_key,'startDate',e.start_local_date,'endDate',e.end_local_date,'kind',e.kind,'contentHash',e.content_hash,'status',e.event_status,'evidence',e.evidence,'reviewRequired',e.review_required)
$$;
create function private.calendar_notice(p_event uuid,p_job uuid,p_run uuid,p_type text,p_key text default '') returns boolean language plpgsql security definer set search_path='' as $$
declare e public.calendar_events;prior jsonb;n integer;begin
 select * into e from public.calendar_events where id=p_event;
 select before_snapshot into prior from public.calendar_event_history where event_id=p_event and run_id=p_run order by created_at desc limit 1;
 insert into public.calendar_changes(event_id,job_id,type,before_start_date,before_end_date,after_start_date,after_end_date,transition_version,notice_key)
 values(e.id,p_job,p_type,(prior->>'start_local_date')::date,(prior->>'end_local_date')::date,
 case when e.source_status='active' then e.start_local_date end,case when e.source_status='active' then e.end_local_date end,
 e.transition_version,coalesce(p_job::text,'event')||':'||p_type||':'||p_key) on conflict(event_id,transition_version,notice_key) do nothing;
 get diagnostics n=row_count;return n=1;end $$;
create function private.calendar_audit(p_job uuid,p_run uuid,p_actor uuid,p_action text,p_before jsonb) returns void language sql security definer set search_path='' as $$
 insert into public.job_history(job_id,actor_id,action,before_snapshot,after_snapshot,request_id) values(p_job,p_actor,p_action,p_before,private.job_snapshot(p_job),p_run::text)
$$;
create function private.calendar_link(p_job uuid,p_event uuid,p_run uuid,p_actor uuid,p_action text) returns void language plpgsql security definer set search_path='' as $$
declare n integer;begin
 if p_action='linked' then insert into public.job_events values(p_job,p_event) on conflict do nothing;get diagnostics n=row_count;
 elsif p_action='unlinked' then delete from public.job_events where job_id=p_job and event_id=p_event;get diagnostics n=row_count;
 else n:=1;end if;
 if n>0 then insert into public.job_event_history(job_id,event_id,run_id,actor_id,action,event_version)
 select p_job,p_event,p_run,p_actor,p_action,transition_version from public.calendar_events where id=p_event on conflict do nothing;end if;
end $$;
create function private.calendar_apply(p_source uuid,p_run uuid,p_actor uuid,p_snapshot jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.properties;item jsonb;e public.calendar_events;old_e public.calendar_events;j public.jobs;b jsonb;pair record;
 changed uuid[]:='{}';n_created integer:=0;n_updated integer:=0;n_removed integer:=0;n_unchanged integer:=0;n_conflicts integer:=0;
 was_new boolean;has_claim boolean;notice_type text;note boolean;begin
 select p0.* into p from public.properties p0 join public.calendar_sources s on s.property_id=p0.id where s.id=p_source;
 -- Coverage is null even when complete=true. Product ambiguity is a fail-closed gate,
 -- not an implied change to the agreed blocked-period requirement.
 if private.calendar_cleaning_policy()='pending' and (
 exists(select 1 from jsonb_array_elements(p_snapshot->'events') x where x->>'kind'<>'reservation') or
 exists(select 1 from public.calendar_events x join public.calendar_sources s on s.id=x.source_id where s.property_id=p.id and x.kind<>'reservation')) then
 perform private.calendar_error('CONFIGURATION_ERROR');end if;
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
 if not was_new or e.review_required or e.event_status='cancelled' then
 perform private.calendar_notice(e.id,null,p_run,case when e.source_status='removed' then 'removed' when was_new then 'conflict' else 'changed' end);
 end if;
 end loop;
 for old_e in select * from public.calendar_events where source_id=p_source and source_status='active' and last_seen_run_id is distinct from p_run loop
 update public.calendar_events set source_status='removed',missing_reason='horizon_unknown',transition_version=transition_version+1,updated_at=clock_timestamp() where id=old_e.id returning * into e;
 insert into public.calendar_event_history(event_id,run_id,before_snapshot,after_snapshot) values(e.id,p_run,to_jsonb(old_e),to_jsonb(e));
 changed:=array_append(changed,e.id);n_removed:=n_removed+1;perform private.calendar_notice(e.id,null,p_run,'removed');
 end loop;
 -- Preserve protected linked jobs before considering any new checkout date.
 for e in select * from public.calendar_events where id=any(changed) order by id loop
 notice_type:=case when e.source_status='removed' then 'removed' else 'changed' end;
 for j in select j0.* from public.jobs j0 join public.job_events je on je.job_id=j0.id where je.event_id=e.id order by j0.id loop
 b:=private.job_snapshot(j.id);has_claim:=exists(select 1 from public.assignments where job_id=j.id and ended_at is null);
 note:=private.calendar_notice(e.id,j.id,p_run,notice_type);
 if j.status='completed' then
 if note then perform private.calendar_audit(j.id,p_run,p_actor,'calendar_completed_warning',b);end if;
 elsif j.status='open' and (has_claim or j.review_required or e.missing_reason is not null) then
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
 for e in select x.* from public.calendar_events x join public.calendar_sources s on s.id=x.source_id where s.property_id=p.id and x.source_status='active' and x.id=any(changed) order by x.end_local_date,x.id loop
 if exists(select 1 from public.job_events je join public.jobs z on z.id=je.job_id where je.event_id=e.id and (z.status='completed' or (z.status='open' and (z.review_required or exists(select 1 from public.assignments a where a.job_id=z.id and a.ended_at is null)))) and z.checkout_date<>e.end_local_date) then continue;end if;
 select * into j from public.jobs where property_id=p.id and checkout_date=e.end_local_date;
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

create function public.bloom_calendar_finish_sync(p_actor uuid,p_source uuid,p_run uuid,p_version bigint,p_snapshot jsonb,p_validators jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.properties;s public.calendar_sources;r public.calendar_sync_runs;h text;v_result jsonb;outcome text;v text;begin
 perform private.calendar_actor(p_actor);p:=private.calendar_property(p_source);
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
revoke all on function public.bloom_calendar_finish_sync(uuid,uuid,uuid,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.bloom_calendar_finish_sync(uuid,uuid,uuid,bigint,jsonb,jsonb) to service_role;
do $$ declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'calendar_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;end $$;
commit;
