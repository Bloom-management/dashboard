begin;
-- Keep immutable event provenance, but never replay an obsolete queued change or
-- describe a cleaner as withdrawn after an authorized manager has re-assigned them.
alter function private.notification_content(uuid,timestamptz,boolean) rename to notification_content_before_freshness;
create function private.notification_content(p_event uuid,p_now timestamptz,p_push boolean default true) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e private.notification_events;content jsonb;begin
 select * into e from private.notification_events where id=p_event;
 if e.kind='withdrawn' and exists(select 1 from public.assignments where job_id=e.job_id and cleaner_id=(e.payload->>'cleanerId')::uuid and ended_at is null) then return null;end if;
 if e.kind in ('extended','changed','cancelled','rate_changed') and exists(
  select 1 from private.notification_events later where later.user_id=e.user_id and later.job_id=e.job_id
   and later.kind in ('extended','changed','cancelled','rate_changed') and later.created_at>e.created_at
 ) then return null;end if;
 content:=private.notification_content_before_freshness(p_event,p_now,p_push);
 if content is not null and e.payload->>'audience'='participant' and e.job_id is not null then
  content:=jsonb_set(content,'{url}',to_jsonb(case when e.kind='adjustment' then '/cleaner?view=payouts' else
   '/cleaner?view='||case when e.kind in ('completed','cancelled') then 'calendar' else 'upcoming' end||'&date='||(select checkout_date from public.jobs where id=e.job_id)||'&job='||e.job_id end));
 end if;
 return content;
end $$;
revoke all on function private.notification_content_before_freshness(uuid,timestamptz,boolean),private.notification_content(uuid,timestamptz,boolean) from public,anon,authenticated,service_role;
-- Preserve existing assignment dismissal keys and the live lifetime of an open assignment.
do $$declare definition text;begin
 definition:=pg_get_functiondef('private.inbox_items()'::regprocedure);
 definition:=replace(definition,$needle$select 'event:'||e.id,c.value->>'body'$needle$,$replacement$select case when e.kind='assigned' then 'assignment:'||(e.payload->>'assignmentId') else 'event:'||e.id end,c.value->>'body'$replacement$);
 execute definition;
 definition:=pg_get_functiondef('private.notification_content_before_freshness(uuid,timestamptz,boolean)'::regprocedure);
 definition:=replace(definition,'or e.expires_at<=p_now','or (e.expires_at<=p_now and (p_push or e.kind<>''assigned''))');
 execute definition;
end $$;
commit;
