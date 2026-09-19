begin;
-- Trusted local maintenance only. Invalidate stale metadata while holding each job lock
-- before deleting bytes, so concurrent finalization and authenticated uploads fail safely.
create function public.bloom_expire_pending_photos(p_limit integer default 100) returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate record;removed_path text;paths jsonb:='[]';begin
 if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN';end if;
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR';end if;
 for candidate in select id,job_id from public.job_photos where state='pending' and created_at<clock_timestamp()-interval '24 hours' order by job_id,id limit p_limit loop
 perform 1 from public.jobs where id=candidate.job_id for update;
 delete from public.job_photos where id=candidate.id and state='pending' and created_at<clock_timestamp()-interval '24 hours' returning object_path into removed_path;
 if removed_path is not null then paths:=paths||jsonb_build_array(removed_path);end if;
 end loop;return paths;end $$;
revoke all on function public.bloom_expire_pending_photos(integer) from public,anon,authenticated;
grant execute on function public.bloom_expire_pending_photos(integer) to service_role;
commit;
