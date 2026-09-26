begin;
-- Keep the existing inbox and dismissal boundary. Derive actionable team notices
-- from current assignments and management requests instead of stale event text.
alter function private.inbox_items() rename to inbox_items_before_team_requests;
create function private.inbox_items() returns table(id text,body text,href text,dismissible boolean)
language plpgsql stable security definer set search_path='' as $$
declare actor public.users;begin
 actor:=private.require_actor();
 return query
 select i.id,i.body,i.href,i.dismissible
 from private.inbox_items_before_team_requests() i
 left join private.team_notices t on i.id='team:'||t.id::text
 where (t.id is null or (
  t.user_id=actor.id
  and exists(select 1 from public.properties p where p.id=t.property_id and p.active and p.deleted_at is null)
  and case when actor.role='cleaner' then
   case when t.job_id is null then private.team_member(t.property_id,actor.id)
   else exists(select 1 from public.assignments a join public.jobs j on j.id=a.job_id where a.job_id=t.job_id and a.cleaner_id=actor.id and a.ended_at is null and j.status='open') end
  else private.people_access(t.property_id,actor.id) end
  -- These obligations are represented once below and disappear when resolved.
  and t.body not in ('You have been assigned a private cleaning.','Your cleaning needs additional team members.','Team member removed. Review their outstanding assignments.')
  and t.body not like 'A cleaner withdrew. A replacement is needed.%'
 )) and not exists(select 1 from public.properties p where i.id='pricing:'||p.id::text and p.cleaning_management='private');
 if actor.role='admin' then
  return query select 'management-property:'||p.id::text,
   p.name||': Bloom cleaning requested.',
   '/admin?view=properties&property='||p.id::text||'&section=settings',false
  from public.properties p where p.bloom_request_status='pending' and p.active and p.deleted_at is null;
  return query select 'management-job:'||j.id::text,
   p.name||': Bloom coverage requested for '||to_char(j.checkout_date,'Mon DD, YYYY')||'.',
   '/admin?view=properties&property='||p.id::text||'&section=settings&job='||j.id::text,false
  from public.jobs j join public.properties p on p.id=j.property_id
  where j.bloom_coverage_requested and j.status='open' and j.cleaning_management='private' and p.active and p.deleted_at is null;
 end if;
 if actor.role in ('owner','admin') then
  return query select 'staffing:'||j.id::text,
   p.name||': cleaning team needs attention for '||to_char(j.checkout_date,'Mon DD, YYYY')||'.'||coalesce((select ' Withdrawal comment: '||a.withdrawal_comment from public.assignments a where a.job_id=j.id and a.end_reason='withdrawn' and a.withdrawal_comment is not null order by a.ended_at desc,a.id limit 1),''),
   case when actor.role='admin' then '/admin?view=properties&property='||p.id::text||'&section=settings&job='||j.id::text
   else '/owner?view=listings&property='||p.id::text||'&job='||j.id::text end,true
  from public.jobs j join public.properties p on p.id=j.property_id
  where j.cleaning_management='private' and j.status='open' and not j.setup_required and p.active and p.deleted_at is null
   and private.people_access(p.id,actor.id)
   and ((select count(*) from public.assignments a where a.job_id=j.id and a.ended_at is null)<j.staffing_capacity
    or exists(select 1 from public.assignments a where a.job_id=j.id and a.ended_at is null and a.needs_resolution));
 end if;
 if actor.role='cleaner' then
  return query select 'assignment:'||a.id::text,
   p.name||': you are assigned to clean on '||to_char(j.checkout_date,'Mon DD, YYYY')||'.',
   '/cleaner?view=upcoming&date='||j.checkout_date::text,true
  from public.assignments a join public.jobs j on j.id=a.job_id join public.properties p on p.id=j.property_id
  where a.cleaner_id=actor.id and a.ended_at is null and j.cleaning_management='private' and j.status='open'
   and not j.setup_required and p.active and p.deleted_at is null;
 end if;
end $$;
revoke all on function private.inbox_items_before_team_requests(),private.inbox_items() from public,anon,authenticated,service_role;
commit;
