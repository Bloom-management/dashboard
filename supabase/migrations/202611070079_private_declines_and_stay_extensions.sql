begin;
-- A date-change offer belongs to the existing job; assignment history is the decline tombstone.
alter table public.jobs add column guest_extension_revision integer not null default 0;
alter table public.assignments add column schedule_revision integer not null default 0;
create function private.assignment_schedule_revision() returns trigger language plpgsql set search_path='' as $$
begin new.schedule_revision:=(select guest_extension_revision from public.jobs where id=new.job_id);return new;end $$;
create trigger assignment_schedule_revision before insert on public.assignments for each row execute function private.assignment_schedule_revision();
CREATE OR REPLACE FUNCTION private.autoassign_private()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m record;s integer:=0;slot_number integer;begin
 if new.cleaning_management<>'private' or new.setup_required or new.status<>'open' then return new;end if;
 if TG_OP='UPDATE' and not old.setup_required then return new;end if;
 -- A decline leaves staffing to the owner; retries must not become automatic replacements.
 if exists(select 1 from public.assignments where job_id=new.id and end_reason='withdrawn') then return new;end if;
 select count(*) into s from public.assignments where job_id=new.id and ended_at is null;
 for m in select t.cleaner_id,case when new.manual_config is null then t.individual_amount_cents else (x.value->>'amountCents')::integer end individual_amount_cents
 from private.property_cleaner_members t join public.users u on u.id=t.cleaner_id
 left join lateral jsonb_array_elements(coalesce(new.manual_config->'cleaners','[]')) x on (x.value->>'cleanerId')::uuid=t.cleaner_id
 where t.property_id=new.property_id and t.active and u.role='cleaner' and u.onboarding_completed_at is not null
 and ((new.manual_config is null and t.default_assigned) or x.value is not null)
 and (new.compensation_mode='equal' or coalesce((x.value->>'amountCents')::integer,t.individual_amount_cents) is not null)
 and not exists(select 1 from public.assignments declined where declined.job_id=new.id and declined.cleaner_id=t.cleaner_id and (declined.ended_at is null or declined.end_reason='withdrawn'))
 and not exists(select 1 from public.assignments a join public.jobs j on j.id=a.job_id where a.cleaner_id=t.cleaner_id and a.ended_at is null and j.status='open' and j.id<>new.id and tstzrange(j.start_at,j.end_at,'[)')&&tstzrange(new.start_at,new.end_at,'[)'))
 order by t.cleaner_id limit greatest(0,new.staffing_capacity-s) loop
 select n into slot_number from generate_series(1,new.staffing_capacity) n where not exists(select 1 from public.assignments a where a.job_id=new.id and a.slot=n and a.ended_at is null) order by n limit 1;
 if slot_number is null then exit;end if;
 s:=s+1;insert into public.assignments(job_id,cleaner_id,slot,agreed_pay_cents) values(new.id,m.cleaner_id,slot_number,case when new.compensation_mode='individual' then m.individual_amount_cents else null end);
 perform private.team_notice(new.property_id,new.id,'You have been assigned a private cleaning.',m.cleaner_id);
 end loop;
 if s<new.staffing_capacity then perform private.team_notice(new.property_id,new.id,'Your cleaning needs additional team members. Review unavailable or insufficient defaults.');end if;return new;
end$function$;

CREATE OR REPLACE FUNCTION private.calendar_apply(p_source uuid, p_run uuid, p_actor uuid, p_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 if j.status='open' and j.started_at is null and not j.review_required and not j.manual_date_override and j.creation_origin='imported'
 and e.source_status='active' and e.missing_reason is null and private.calendar_job_eligible(e) and e.end_local_date>j.checkout_date
 and exists(select 1 from public.calendar_event_history h where h.event_id=e.id and h.run_id=p_run
  and h.before_snapshot->>'kind'='reservation' and h.before_snapshot->>'evidence'='airbnb-reservation-link'
  and (h.before_snapshot->>'end_local_date')::date=j.checkout_date
  and (h.before_snapshot->>'start_local_date')::date=e.start_local_date)
 then
  if exists(select 1 from public.jobs other where other.property_id=j.property_id and other.checkout_date=e.end_local_date and other.id<>j.id)
   or exists(select 1 from public.job_events other where other.job_id=j.id and other.event_id<>e.id)
   or exists(select 1 from private.calendar_returns r where r.event_id=e.id)
  then
   update public.jobs set review_required=true,version=version+1 where id=j.id;
   perform private.calendar_notice(e.id,j.id,p_run,'conflict','extension_conflict');
  else
   update public.jobs set checkout_date=e.end_local_date,
    start_at=(e.end_local_date+(j.start_at at time zone j.timezone_snapshot)::time) at time zone j.timezone_snapshot,
    end_at=(e.end_local_date+(j.end_at at time zone j.timezone_snapshot)::time) at time zone j.timezone_snapshot,
    guest_extension_revision=guest_extension_revision+1,version=version+1,updated_at=clock_timestamp() where id=j.id;
   perform private.calendar_audit(j.id,p_run,p_actor,'guest_stay_extended',b);
  end if;
 elsif j.status='completed' then
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
end $function$;

alter function private.job_dto(uuid) rename to job_dto_before_declines;
create function private.job_dto(p_job uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select private.job_dto_before_declines(p_job)||jsonb_build_object('canDecline',j.status='open' and j.started_at is null and exists(
  select 1 from public.assignments a where a.job_id=j.id and a.cleaner_id=(private.actor()).id and a.ended_at is null
   and (j.cleaning_management='private' or a.schedule_revision<j.guest_extension_revision))) from public.jobs j where j.id=p_job;
$$;
create function public.bloom_decline_job(p_job uuid,p_comment text,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;j public.jobs;a public.assignments;r jsonb;b jsonb;input jsonb:=jsonb_build_object('job',p_job,'comment',p_comment);begin
 u:=private.require_actor();
 if coalesce(length(trim(p_comment)),0) not between 1 and 1000 then raise exception 'VALIDATION_ERROR';end if;
 perform 1 from public.properties where id=(select property_id from public.jobs where id=p_job) for update;
 select * into j from public.jobs where id=p_job for update;
 r:=private.receipt('decline_job',p_key,input);if r is not null then return r;end if;
 select * into a from public.assignments where job_id=p_job and cleaner_id=u.id and ended_at is null;
 if a.id is null then raise exception 'NOT_FOUND';end if;
 if j.status<>'open' or j.started_at is not null or (j.cleaning_management<>'private' and a.schedule_revision>=j.guest_extension_revision) then raise exception 'INVALID_STATE';end if;
 b:=private.job_snapshot(j.id);
 update public.assignments set ended_at=clock_timestamp(),end_reason='withdrawn',withdrawal_comment=trim(p_comment),needs_resolution=false where id=a.id;
 update public.jobs set version=version+1,updated_at=clock_timestamp() where id=j.id;
 perform private.audit(j.id,'decline',b,p_key,jsonb_build_object('comment',trim(p_comment)));
 return private.save_receipt('decline_job',p_key,input,private.job_dto(j.id));
end $$;
revoke all on function private.assignment_schedule_revision(),private.job_dto_before_declines(uuid),private.job_dto(uuid),private.autoassign_private(),private.calendar_apply(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.bloom_decline_job(uuid,text,text) from public,anon;
grant execute on function public.bloom_decline_job(uuid,text,text) to authenticated;
do $$declare definition text;old_call text;begin
 definition:=pg_get_functiondef('private.manual_move_job(uuid,date,time without time zone,time without time zone,text,text)'::regprocedure);
 definition:=replace(definition,'p_reason text)','p_reason text, p_guest_extension boolean)');
 definition:=replace(definition,'manual_date_override=true,version=version+1','manual_date_override=true,guest_extension_revision=guest_extension_revision+case when p_guest_extension then 1 else 0 end,version=version+1');
 execute definition;
 definition:=pg_get_functiondef('public.bloom_property_calendar_action(uuid,text,jsonb,text)'::regprocedure);
 old_call:=$call$perform private.manual_move_job(j.id,co,(j.start_at at time zone j.timezone_snapshot)::time,(j.end_at at time zone j.timezone_snapshot)::time,p_key,p_data->>'reason');$call$;
 if position(old_call in definition)=0 then raise exception 'Manual booking extension insertion point changed';end if;
 definition:=replace(definition,old_call,$call$perform private.manual_move_job(j.id,co,(j.start_at at time zone j.timezone_snapshot)::time,(j.end_at at time zone j.timezone_snapshot)::time,p_key,p_data->>'reason',ci=b.check_in and co>b.checkout);$call$);
 execute definition;
end $$;
revoke all on function private.manual_move_job(uuid,date,time without time zone,time without time zone,text,text,boolean) from public,anon,authenticated,service_role;
commit;
