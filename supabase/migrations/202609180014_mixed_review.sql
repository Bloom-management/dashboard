begin;
-- User-confirmed September 18 policy. Classification confidence
-- is separate from scheduling; unknown/blocked entries remain visible for review.
create or replace function private.calendar_cleaning_policy() returns text
language sql immutable set search_path='' as $$ select 'confirmed_reservations_review_other'::text $$;
create function private.calendar_job_eligible(e public.calendar_events) returns boolean
language sql immutable set search_path='' as $$
 select e.kind='reservation' and e.evidence='airbnb-reservation-link' and not e.review_required
$$;
revoke all on function private.calendar_job_eligible(public.calendar_events) from public,anon,authenticated,service_role;
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
 -- Preserve protected linked jobs before considering any new checkout date.
 for e in select * from public.calendar_events where id=any(changed) order by id loop
 notice_type:=case when e.source_status='removed' then 'removed' else 'changed' end;
 for j in select j0.* from public.jobs j0 join public.job_events je on je.job_id=j0.id where je.event_id=e.id order by j0.id loop
 b:=private.job_snapshot(j.id);has_claim:=exists(select 1 from public.assignments where job_id=j.id and ended_at is null);
 note:=private.calendar_notice(e.id,j.id,p_run,notice_type);
 if j.status='completed' then
 if note then perform private.calendar_audit(j.id,p_run,p_actor,'calendar_completed_warning',b);end if;
 elsif j.status='open' and (has_claim or j.review_required or e.missing_reason is not null or (e.source_status='active' and not private.calendar_job_eligible(e))) then
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

-- Ordinary user-token read; the property path and admin role are independently checked.
create function public.bloom_admin_property_calendar_review(p_property uuid,p_cursor uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 perform private.require_actor('admin');
 if not exists(select 1 from public.properties where id=p_property) then raise exception 'NOT_FOUND';end if;
 with page as (
 select e.id,e.source_id,s.provider,e.start_local_date,e.end_local_date,e.kind,e.source_status,e.review_required,e.missing_reason
 from public.calendar_events e join public.calendar_sources s on s.id=e.source_id
 where s.property_id=p_property and (p_cursor is null or e.id>p_cursor)
 and (e.kind<>'reservation' or e.review_required or e.missing_reason is not null)
 order by e.id limit 101
 ),shown as(select * from page order by id limit 100)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
 'id',e.id,'sourceId',e.source_id,'provider',e.provider,'startDate',e.start_local_date,
 'endDate',e.end_local_date,'kind',e.kind,'status',e.source_status,
 'reviewRequired',e.review_required,'missingReason',e.missing_reason) order by e.id) from shown e),'[]'::jsonb),
 'nextCursor',case when (select count(*) from page)>100 then (select max(id::text) from shown) else null end) into result;
 return result;
end $$;
revoke all on function public.bloom_admin_property_calendar_review(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.bloom_admin_property_calendar_review(uuid,uuid) to authenticated;
commit;
