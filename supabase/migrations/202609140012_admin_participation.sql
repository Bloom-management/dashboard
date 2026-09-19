-- Admins participate as themselves in any city. All shared lifecycle locks,
-- capacity, photo coverage, uploader ownership and immutable history remain.
begin;
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
 if (select count(distinct category) from public.job_photos where job_id=j.id and state='ready')<>4 then raise exception 'PHOTO_COVERAGE_REQUIRED';end if;
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

create or replace function private.guard_assignment() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='DELETE' then raise exception 'INVALID_STATE';end if;
 if TG_OP='UPDATE' and (new.job_id<>old.job_id or new.cleaner_id<>old.cleaner_id or new.slot<>old.slot or new.claimed_at<>old.claimed_at or old.ended_at is not null or old.completed_pay_cents is not null) then raise exception 'INVALID_STATE';end if;
 perform 1 from public.jobs where id=new.job_id for update;
 if exists(select 1 from public.jobs where id=new.job_id and status<>'open') then raise exception 'INVALID_STATE';end if;
 if not exists(select 1 from public.users where id=new.cleaner_id and role in ('cleaner','admin')) then raise exception 'INVALID_STATE';end if;
 return new;end $$;

create or replace function public.bloom_photo_prepare(p_job uuid,p_category text,p_mime text,p_bytes integer,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;r jsonb; photo uuid:=gen_random_uuid();i jsonb:=jsonb_build_object('job',p_job,'category',p_category,'mime',p_mime,'bytes',p_bytes);begin
 u:=private.require_actor();if u.role not in ('cleaner','admin') then raise exception 'FORBIDDEN';end if;
 perform 1 from public.jobs where id=p_job for update;
 if not private.photo_access(p_job,true) then raise exception 'NOT_FOUND';end if;
 r:=private.receipt('photo_prepare',p_key,i);if r is not null then return r;end if;
 if p_category is null or p_category not in ('bedrooms','bathrooms','kitchen','living_room') or p_mime is null or p_mime not in ('image/jpeg','image/png','image/webp') or p_bytes is null or p_bytes not between 1 and 10485760 then raise exception 'VALIDATION_ERROR';end if;
 insert into public.job_photos(id,job_id,uploader_id,category,object_path,bytes,mime) values(photo,p_job,u.id,p_category,p_job::text||'/'||photo::text,p_bytes,p_mime);
 r:=jsonb_build_object('photoId',photo,'bucket','job-photos','path',p_job::text||'/'||photo::text);
 return private.save_receipt('photo_prepare',p_key,i,r);end $$;

create or replace function public.bloom_photo_finalize_verified(p_subject text,p_job uuid,p_photo uuid,p_bytes integer,p_mime text,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;p public.job_photos;r jsonb;i jsonb:=jsonb_build_object('job',p_job,'photo',p_photo,'bytes',p_bytes,'mime',p_mime);begin
 if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN';end if;
 select * into u from public.users where clerk_user_id=p_subject and role in ('cleaner','admin');if not found then raise exception 'FORBIDDEN';end if;
 perform 1 from public.jobs where id=p_job for update;
 if not exists(select 1 from public.assignments a join public.jobs j on j.id=a.job_id where j.id=p_job and a.cleaner_id=u.id and a.ended_at is null and j.status='open' and not j.review_required) then raise exception 'NOT_FOUND';end if;
 select * into p from public.job_photos where id=p_photo and job_id=p_job and uploader_id=u.id for update;if not found then raise exception 'NOT_FOUND';end if;
 if p_bytes is distinct from p.bytes or p_mime is distinct from p.mime then raise exception 'VALIDATION_ERROR';end if;
 if p_key is null or length(p_key) not between 1 and 200 then raise exception 'VALIDATION_ERROR';end if;
 select result into r from public.operation_receipts where actor_id=u.id and operation='photo_finalize' and idempotency_key=p_key and input_hash=i::text;
 if r is not null then return r;end if;
 if exists(select 1 from public.operation_receipts where actor_id=u.id and operation='photo_finalize' and idempotency_key=p_key) then raise exception 'CONFLICT';end if;
 update public.job_photos set state='ready' where id=p.id;
 r:=private.photo_dto(p.id);
 insert into public.operation_receipts(actor_id,operation,idempotency_key,input_hash,result) values(u.id,'photo_finalize',p_key,i::text,r);
 return r;end $$;
revoke all on function private.job_action_v1(uuid,text,text,integer,jsonb),private.guard_assignment() from public,anon,authenticated,service_role;
commit;
