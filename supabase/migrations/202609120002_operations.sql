begin;
create function public.bloom_me() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u public.users;begin u:=private.require_actor();return jsonb_build_object('id',u.id,'role',u.role,'displayName',u.display_name,'approvedCityId',u.approved_city_id);end $$;
create function public.bloom_onboard(p_city uuid,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;r jsonb; i jsonb:=jsonb_build_object('city',p_city); subject text:=auth.jwt()->>'sub';begin
 if subject is null or subject='' then raise exception 'UNAUTHENTICATED';end if;
 perform pg_advisory_xact_lock(hashtextextended('onboard:'||subject,0));
 if not exists(select 1 from public.cities where id=p_city and active) then raise exception 'VALIDATION_ERROR';end if;
 insert into public.users(clerk_user_id) values(subject) on conflict(clerk_user_id) do nothing;
 u:=private.require_actor('cleaner');r:=private.receipt('onboard',p_key,i);if r is not null then return r;end if;
 if u.initial_city_selected_at is not null then raise exception 'INVALID_STATE';end if;
 update public.users set approved_city_id=p_city,initial_city_selected_at=clock_timestamp(),updated_at=clock_timestamp() where id=u.id;
 return private.save_receipt('onboard',p_key,i,public.bloom_me());end $$;
create function public.bloom_city_request(p_city uuid,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;r jsonb;i jsonb:=jsonb_build_object('city',p_city);begin
 u:=private.require_actor('cleaner');r:=private.receipt('city_request',p_key,i);if r is not null then return r;end if;
 perform 1 from public.users where id=u.id for update;
 if u.initial_city_selected_at is null or u.approved_city_id=p_city or not exists(select 1 from public.cities where id=p_city and active) then raise exception 'VALIDATION_ERROR';end if;
 if exists(select 1 from public.city_change_requests where cleaner_id=u.id and status='pending') then raise exception 'CONFLICT';end if;
 insert into public.city_change_requests(cleaner_id,requested_city_id) values(u.id,p_city) returning to_jsonb(city_change_requests.*) into r;
 return private.save_receipt('city_request',p_key,i,r);end $$;
create function public.bloom_city_resolve(p_request uuid,p_decision text,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;q public.city_change_requests;r jsonb;i jsonb:=jsonb_build_object('request',p_request,'decision',p_decision);begin
 u:=private.require_actor('admin');r:=private.receipt('city_resolve',p_key,i);if r is not null then return r;end if;
 if p_decision not in ('approved','rejected') or p_decision is null then raise exception 'VALIDATION_ERROR';end if;
 select * into q from public.city_change_requests where id=p_request for update;if not found then raise exception 'NOT_FOUND';end if;
 if q.status<>'pending' then raise exception 'INVALID_STATE';end if;
 if p_decision='approved' then
 if not exists(select 1 from public.cities where id=q.requested_city_id and active) then raise exception 'INVALID_STATE';end if;
 update public.users set approved_city_id=q.requested_city_id,updated_at=clock_timestamp() where id=q.cleaner_id and role='cleaner';if not found then raise exception 'INVALID_STATE';end if;end if;
 update public.city_change_requests set status=p_decision,resolved_by=u.id,resolved_at=clock_timestamp(),updated_at=clock_timestamp() where id=q.id returning to_jsonb(city_change_requests.*) into r;
 return private.save_receipt('city_resolve',p_key,i,r);end $$;
create function private.job_dto(p_job uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',j.id,'propertyId',p.id,'propertyName',p.name,'cityId',p.city_id,'checkoutDate',j.checkout_date,
 'startAt',j.start_at,'endAt',j.end_at,'timezone',j.timezone_snapshot,'status',j.status,'reviewRequired',j.review_required,'version',j.version,
 'soloRateCents',j.solo_rate_cents_snapshot,'sharedRateCents',j.solo_rate_cents_snapshot/2,
 'activeCleanerCount',(select count(*) from public.assignments a where a.job_id=j.id and a.ended_at is null),
 'myAssignmentId',(select a.id from public.assignments a where a.job_id=j.id and a.cleaner_id=(private.actor()).id and a.ended_at is null),
 'myCompletedPayCents',(select a.completed_pay_cents from public.assignments a where a.job_id=j.id and a.cleaner_id=(private.actor()).id and a.ended_at is null),'changes','[]'::jsonb)
 from public.jobs j join public.properties p on p.id=j.property_id where j.id=p_job
$$;
create function public.bloom_jobs(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u public.users;begin u:=private.require_actor();if u.role='owner' then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>92 then raise exception 'VALIDATION_ERROR';end if;
 return (select coalesce(jsonb_agg(private.job_dto(j.id) order by j.start_at,j.id),'[]') from public.jobs j join public.properties p on p.id=j.property_id where j.checkout_date between p_from and p_to and (u.role='admin' or p.city_id=u.approved_city_id or private.assigned(j.id)));end $$;
-- Central lifecycle lock: claim, withdrawal, completion and admin operations all lock the job first.
create function public.bloom_job_action(p_job uuid,p_action text,p_key text,p_expected_version integer default null,p_payload jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;j public.jobs;p public.properties;a public.assignments; n integer;s smallint;r jsonb;b jsonb;t timestamptz;
 target public.users;input jsonb:=jsonb_build_object('job',p_job,'action',p_action,'version',p_expected_version,'payload',p_payload);begin
 u:=private.require_actor();
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or exists(select 1 from jsonb_object_keys(p_payload) k where not (k=any(case p_action when 'cancel' then array['reason'] when 'reassign' then array['reason','cleanerId','removeAssignmentId'] when 'keep' then array['reason'] when 'reschedule' then array['reason','checkoutDate'] else array[]::text[] end))) then raise exception 'VALIDATION_ERROR';end if;
 if p_action in ('cancel','reassign','keep','reschedule') then if u.role<>'admin' then raise exception 'FORBIDDEN';end if;
 elsif p_action in ('claim','withdraw','complete') then if u.role<>'cleaner' then raise exception 'FORBIDDEN';end if;else raise exception 'VALIDATION_ERROR';end if;
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
 if u.role<>'cleaner' or p.city_id is distinct from u.approved_city_id then raise exception 'CITY_MISMATCH';end if;
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
 if (select count(distinct category) from public.job_photos where job_id=j.id and state='ready')<>4 then raise exception 'PHOTO_COVERAGE_REQUIRED';end if;
 select count(*) into n from public.assignments where job_id=j.id and ended_at is null;
 update public.assignments set completed_pay_cents=j.solo_rate_cents_snapshot/n where job_id=j.id and ended_at is null;
 update public.jobs set status='completed',completed_at=t,completed_by=u.id,version=version+1,updated_at=t where id=j.id;
 elsif p_action='cancel' then
 update public.assignments set ended_at=t,end_reason='cancelled' where job_id=j.id and ended_at is null;
 update public.jobs set status='cancelled',review_required=false where id=j.id;
 elsif p_action='reassign' then
 select * into target from public.users where id=(p_payload->>'cleanerId')::uuid for update;
 if target.id is null or target.role<>'cleaner' or target.approved_city_id is distinct from p.city_id then raise exception 'CITY_MISMATCH';end if;
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

-- Defense against privileged ingestion accidentally rewriting completed history.
create function private.guard_assignment() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='DELETE' then raise exception 'INVALID_STATE';end if;
 if TG_OP='UPDATE' and (new.job_id<>old.job_id or new.cleaner_id<>old.cleaner_id or new.slot<>old.slot or new.claimed_at<>old.claimed_at or old.ended_at is not null or old.completed_pay_cents is not null) then raise exception 'INVALID_STATE';end if;
 perform 1 from public.jobs where id=new.job_id for update;
 if exists(select 1 from public.jobs where id=new.job_id and status<>'open') then raise exception 'INVALID_STATE';end if;
 if not exists(select 1 from public.users where id=new.cleaner_id and role='cleaner') then raise exception 'INVALID_STATE';end if;
 return new;end $$;
create trigger assignment_guard before insert or update or delete on public.assignments for each row execute function private.guard_assignment();
create function private.guard_job() returns trigger language plpgsql set search_path='' as $$ begin
 if TG_OP='DELETE' then raise exception 'INVALID_STATE';end if;
 if TG_OP='UPDATE' and old.status='completed' and new is distinct from old then raise exception 'INVALID_STATE';end if;
 if not exists(select 1 from pg_timezone_names where name=new.timezone_snapshot) or new.start_at is distinct from ((new.checkout_date+time '11:00') at time zone new.timezone_snapshot) or new.end_at is distinct from ((new.checkout_date+time '15:00') at time zone new.timezone_snapshot) then raise exception 'VALIDATION_ERROR';end if;
 return new;end $$;
create trigger job_guard before insert or update or delete on public.jobs for each row execute function private.guard_job();
create function private.immutable() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'INVALID_STATE';end $$;
create trigger history_immutable before update or delete on public.job_history for each row execute function private.immutable();
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.actor(),private.is_admin(),private.assigned(uuid),private.photo_access(uuid,boolean) to authenticated;
revoke all on function public.bloom_me(),public.bloom_onboard(uuid,text),public.bloom_city_request(uuid,text),public.bloom_city_resolve(uuid,text,text),public.bloom_jobs(date,date),public.bloom_job_action(uuid,text,text,integer,jsonb) from public,anon;
grant execute on function public.bloom_me(),public.bloom_onboard(uuid,text),public.bloom_city_request(uuid,text),public.bloom_city_resolve(uuid,text,text),public.bloom_jobs(date,date),public.bloom_job_action(uuid,text,text,integer,jsonb) to authenticated;
commit;
