begin;

-- Retain the existing function OID so the jobs RLS policy uses this boundary too.
-- Entire-home visibility and claimable room visits keep their existing behavior.
do $$declare def text;begin
 def:=pg_get_functiondef('private.job_visible(uuid)'::regprocedure);
 execute replace(def,'FUNCTION private.job_visible(','FUNCTION private.job_visible_before_completed_visits(');
end$$;
create or replace function private.job_visible(p_job uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.jobs where id=p_job and house_id is not null and status='completed')
 then private.visit_access(p_job)
 else private.job_visible_before_completed_visits(p_job) end
$$;
revoke all on function private.job_visible_before_completed_visits(uuid) from public,anon,authenticated,service_role;

-- A report must use the same room-visit authorization as its notes and photos.
-- Otherwise city-level legacy visibility exposes a receipt whose attachments fail.
do $$declare def text;begin
 def:=pg_get_functiondef('public.bloom_cleaning_report(uuid)'::regprocedure);
 execute replace(def,'FUNCTION public.bloom_cleaning_report(','FUNCTION private.cleaning_report_before_completed_visits(');
end$$;
create or replace function public.bloom_cleaning_report(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare room_visit boolean;result jsonb;begin
 perform private.require_actor();
 select house_id is not null into room_visit from public.jobs where id=p_job;
 if room_visit and not private.visit_access(p_job) then raise exception 'NOT_FOUND';end if;
 result:=private.cleaning_report_before_completed_visits(p_job);
 if room_visit then result:=result||jsonb_build_object('propertyName',private.job_dto(p_job)->>'propertyName');end if;
 return result;
end$$;
revoke all on function private.cleaning_report_before_completed_visits(uuid) from public,anon,authenticated,service_role;

commit;
