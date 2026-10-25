begin;
-- Read current property state without altering immutable completion reports.
create function private.active_report_details(p_job uuid,p_kind text) returns text
language sql stable set search_path='' as $$
 select case when p_kind='low_supplies' then (
  select string_agg(r.name,', ' order by r.name)
  from public.job_supply_reports r join public.jobs j on j.id=r.job_id
  where r.job_id=p_job and r.level in ('low','empty')
   and exists(select 1 from public.properties p cross join lateral jsonb_array_elements(coalesce(p.cleaning_config->'supplies','[]')) s where p.id=j.property_id and s->>'id'=r.supply_id::text)
   and r.job_id=(select x.job_id from public.job_supply_reports x join public.jobs newer on newer.id=x.job_id where newer.property_id=j.property_id and newer.status='completed' and x.supply_id=r.supply_id order by newer.completed_at desc,x.reported_at desc,newer.id desc limit 1)
   and not exists(select 1 from private.supply_purchases s where s.property_id=j.property_id and s.supply_id=r.supply_id and s.restocked_at>r.reported_at)
 ) when p_kind='maintenance' then (
  select string_agg(case r.category when 'fridge' then 'Refrigerator' when 'wifi' then 'Wi-Fi' when 'tv' then 'TV' else initcap(r.category) end,', ' order by r.category)
  from public.job_maintenance_reports r join public.jobs j on j.id=r.job_id join public.users reporter on reporter.id=r.reported_by
  where r.job_id=p_job and r.status='attention' and reporter.role='cleaner'
   and r.job_id=(select x.job_id from public.job_maintenance_reports x join public.jobs newer on newer.id=x.job_id where newer.property_id=j.property_id and newer.status='completed' and x.category=r.category order by x.reported_at desc,x.job_id desc limit 1)
 ) end;
$$;
alter function private.inbox_items() rename to inbox_items_before_resolution;
create function private.inbox_items() returns table(id text,body text,href text,dismissible boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 return query select i.id,case when a.job_id is not null then replace(i.body,a.details,live.details) else i.body end,i.href,i.dismissible
 from private.inbox_items_before_resolution() i
 left join private.property_report_alerts a on i.id=a.kind||':'||a.job_id
 left join lateral (select private.active_report_details(a.job_id,a.kind) details) live on a.job_id is not null
 where (a.job_id is null or live.details is not null)
 and not exists(select 1 from public.jobs j where i.id='start:'||j.id and j.status='completed');
end $$;
-- Suppress queued report pushes too; already delivered OS notifications cannot be recalled.
alter function private.push_content(uuid,timestamptz) rename to push_content_before_resolution;
create function private.push_content(p_message uuid,p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare content jsonb;m private.push_messages;details text;old_details text;begin
 content:=private.push_content_before_resolution(p_message,p_now);
 if content is null then return null;end if;
 select * into m from private.push_messages where id=p_message;
 if m.kind in ('low_supplies','maintenance') then
  details:=private.active_report_details(m.job_ids[1],m.kind);
  if details is null then return null;end if;
  select a.details into old_details from private.property_report_alerts a where a.job_id=m.job_ids[1] and a.kind=m.kind;
  content:=jsonb_set(content,'{body}',to_jsonb(replace(content->>'body',old_details,details)));
 end if;
 return content;
end $$;
create function private.notification_created_at(p_key text) returns timestamptz
language sql stable set search_path='' as $$
 select coalesce(
 (select created_at from private.property_report_alerts where p_key=kind||':'||job_id),
 (select started_at from private.cleaning_start_events where p_key='start:'||job_id),
 (select completed_at from private.cleaning_activity_events where p_key='completion:'||job_id),
 (select created_at from private.team_notices where p_key='team:'||id),
 (select created_at from private.push_messages where p_key='push:'||id),
 (select h.updated_at from private.cleaning_handoff_notices n join private.cleaning_handoffs h on h.job_id=n.job_id where p_key='handoff:'||n.id),
 (select created_at from public.calendar_changes where p_key='change:'||id),
 (select claimed_at from public.assignments where p_key='assignment:'||id),
 (select max(p.created_at) from private.payout_notification_events e join private.payout_payments p on p.id=e.payment_id where split_part(p_key,':',1)='payment' and split_part(p_key,':',2)=e.batch_id::text),
 (select coalesce(last_attempt_at,created_at) from public.calendar_sources where p_key='sync:'||id),
 (select created_at from public.jobs where p_key in ('staffing:'||id,'management-job:'||id)),
 (select created_at from public.properties where p_key in ('pricing:'||id,'management-property:'||id,'property:setup:'||id)),
 (select max(j.completed_at) from public.assignments a join public.jobs j on j.id=a.job_id where p_key='payout:'||a.cleaner_id and j.status='completed'),
 (select created_at from public.users where id=(private.actor()).id),'-infinity'::timestamptz);
$$;
create or replace function public.bloom_notification_inbox(p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u public.users;result jsonb;begin
 u:=private.require_actor();if p_offset<0 or p_offset>100000 then raise exception 'VALIDATION_ERROR';end if;
 with visible as (select i.*,private.notification_created_at(i.id) as "createdAt" from private.inbox_items() i where not exists(select 1 from private.notification_dismissals d where d.user_id=u.id and d.notification_key=i.id)),
 page as(select * from visible order by "createdAt" desc,id desc limit 10 offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page) order by "createdAt" desc,id desc) from page),'[]'),'total',(select count(*) from visible)) into result;
 return result;
end $$;
-- Include invitation timestamps so the HTTP layer can merge them chronologically.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.bloom_team_invites_incoming(text[])'::regprocedure);
 if position('''expiresAt'',i.expires_at' in definition)=0 then raise exception 'Invitation timestamp insertion point missing';end if;
 execute replace(definition,'''expiresAt'',i.expires_at','''createdAt'',i.created_at,''expiresAt'',i.expires_at');
end $$;
revoke all on function private.active_report_details(uuid,text),private.inbox_items_before_resolution(),private.inbox_items(),private.push_content_before_resolution(uuid,timestamptz),private.push_content(uuid,timestamptz),private.notification_created_at(text) from public,anon,authenticated,service_role;
commit;
