-- Admins can fill an open slot directly ("Assign" in the admin hub's Who's working card).
-- Mirrors reassign: admin only, current version, reason required, city eligibility, no duplicates,
-- audited and idempotent. Every other action passes through unchanged.
alter function public.bloom_job_action(uuid,text,text,integer,jsonb) rename to bloom_job_action_before_admin_assign;
create function public.bloom_job_action(p_job uuid,p_action text,p_key text,p_expected_version integer default null,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;j public.jobs;p public.properties;target public.users;r jsonb;b jsonb;s integer;t timestamptz;
 scope text;input jsonb:=jsonb_build_object('job',p_job,'action',p_action,'version',p_expected_version,'payload',p_payload);
begin
 if p_action<>'assign' then return public.bloom_job_action_before_admin_assign(p_job,p_action,p_key,p_expected_version,p_payload);end if;
 u:=private.require_actor();if u.role<>'admin' then raise exception 'FORBIDDEN';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('reason','cleanerId'))
  or coalesce(length(trim(p_payload->>'reason')),0) not between 1 and 1000 or coalesce(p_payload->>'cleanerId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'VALIDATION_ERROR';end if;
 select * into j from public.jobs where id=p_job;if not found then raise exception 'NOT_FOUND';end if;
 -- Same lock order as the room-visit wrapper: house lock first, then the job row.
 if j.house_id is not null then perform pg_advisory_xact_lock(hashtextextended('house-visit:'||j.house_id,0));end if;
 scope:=case when j.house_id is not null then 'room_job_action' else 'job_action' end;
 r:=private.receipt(scope,p_key,input);if r is not null then return r;end if;
 select * into j from public.jobs where id=p_job for update;
 if j.status<>'open' or j.cleaning_management='private' then raise exception 'INVALID_STATE';end if;
 if p_expected_version is null or p_expected_version<>j.version then raise exception 'CONFLICT';end if;
 select * into p from public.properties where id=j.property_id;
 select * into target from public.users where id=(p_payload->>'cleanerId')::uuid for update;
 if target.id is null or target.role not in ('cleaner','admin') or (target.role='cleaner' and target.approved_city_id is distinct from p.city_id) then raise exception 'CITY_MISMATCH';end if;
 if exists(select 1 from public.assignments where job_id=j.id and cleaner_id=target.id and ended_at is null) then raise exception 'ALREADY_ASSIGNED';end if;
 select candidate into s from generate_series(1,2) candidate where not exists(select 1 from public.assignments x where x.job_id=j.id and x.slot=candidate and x.ended_at is null) order by candidate limit 1;
 if s is null then raise exception 'JOB_FULL';end if;
 t:=clock_timestamp();b:=private.job_snapshot(j.id);
 insert into public.assignments(job_id,cleaner_id,slot,claimed_at) values(j.id,target.id,s,t);
 update public.jobs set version=version+1,updated_at=t where id=j.id;
 if j.house_id is not null then
  -- Same follow-up as a claim on a grouped room visit.
  update private.visit_proposals set state='stale' where job_id=j.id and state='pending';
  if exists(select 1 from private.room_turnovers where job_id=j.id and state='pending' and not included) then perform private.visit_propose(j.id);end if;
 end if;
 perform private.audit(j.id,'assign',b,p_key,p_payload);
 return private.save_receipt(scope,p_key,input,private.job_dto(j.id));
end$$;
revoke all on function public.bloom_job_action_before_admin_assign(uuid,text,text,integer,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.bloom_job_action(uuid,text,text,integer,jsonb) from public,anon;
grant execute on function public.bloom_job_action(uuid,text,text,integer,jsonb) to authenticated;
