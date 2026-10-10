begin;
-- Management removal is separate from a cleaner's time-limited withdrawal.
create function public.bloom_remove_job_assignment(p_job uuid,p_assignment uuid,p_reason text,p_version integer,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.users;j public.jobs;a public.assignments;b jsonb;r jsonb;
 input jsonb:=jsonb_build_object('job',p_job,'assignment',p_assignment,'reason',p_reason,'version',p_version);
begin
 u:=private.require_actor();
 perform 1 from public.properties where id=(select property_id from public.jobs where id=p_job) for update;
 select * into j from public.jobs where id=p_job for update;
 if j.id is null or not (u.role='admin' or (u.role='owner' and j.cleaning_management='private' and private.people_access(j.property_id,u.id))) then raise exception 'NOT_FOUND';end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 1000 then raise exception 'VALIDATION_ERROR';end if;
 r:=private.receipt('remove_job_assignment',p_key,input);if r is not null then return r;end if;
 if j.status<>'open' then raise exception 'INVALID_STATE';end if;
 if p_version is null or p_version<>j.version then raise exception 'CONFLICT';end if;
 select * into a from public.assignments where id=p_assignment and job_id=j.id and ended_at is null for update;
 if a.id is null then raise exception 'NOT_FOUND';end if;
 b:=private.job_snapshot(j.id);
 update public.assignments set ended_at=now(),end_reason='reassigned',withdrawal_comment=trim(p_reason),needs_resolution=false where id=a.id;
 update public.jobs set version=version+1,updated_at=now() where id=j.id;
 perform private.audit(j.id,'remove_assignment',b,p_key,jsonb_build_object('assignmentId',a.id,'cleanerId',a.cleaner_id,'reason',trim(p_reason)));
 return private.save_receipt('remove_job_assignment',p_key,input,jsonb_build_object('jobId',j.id,'assignmentId',a.id,'version',j.version+1));
end $$;
revoke all on function public.bloom_remove_job_assignment(uuid,uuid,text,integer,text) from public,anon,service_role;
grant execute on function public.bloom_remove_job_assignment(uuid,uuid,text,integer,text) to authenticated;
commit;
