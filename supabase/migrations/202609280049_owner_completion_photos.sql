begin;
-- Owners may read completed-job images for their properties, never upload as an owner.
-- Preserve the existing admin and assigned-cleaner access rules.
create or replace function private.photo_access(p_job uuid,p_write boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.jobs j where j.id=p_job and
 (case when p_write then j.status='open' and not j.review_required and private.assigned(j.id)
 else private.is_admin() or private.assigned(j.id)
 or (j.status='completed' and (private.actor()).role='owner' and private.people_access(j.property_id,(private.actor()).id)) end))
$$;
commit;
