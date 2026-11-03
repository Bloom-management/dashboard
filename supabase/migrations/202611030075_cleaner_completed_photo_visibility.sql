begin;

-- Completed jobs close their active assignments. Let a cleaner who can still
-- see that completed job in Cleaner Hub read its completion photos, while
-- keeping upload/write access limited to an active assignment.
create or replace function private.photo_access(p_job uuid,p_write boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select case when p_write then
  exists(select 1 from public.jobs j where j.id=p_job and j.status='open' and not j.review_required and private.assigned(j.id))
 else
  exists(select 1 from public.jobs j where j.id=p_job and (
   private.is_admin()
   or private.assigned(j.id)
   or (j.status='completed' and (
    ((private.actor()).role='owner' and private.people_access(j.property_id,(private.actor()).id))
    or private.job_visible(j.id)
   ))
  ))
 end
$$;

commit;
