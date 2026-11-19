-- Let claim cards tell a started cleaning apart from one still waiting, without exposing who started it.
alter function private.job_dto(uuid) rename to job_dto_before_started_flag;
create function private.job_dto(p_job uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select private.job_dto_before_started_flag(p_job)||jsonb_build_object('started',j.started_at is not null) from public.jobs j where j.id=p_job
$$;
revoke all on function private.job_dto_before_started_flag(uuid),private.job_dto(uuid) from public,anon,authenticated,service_role;
