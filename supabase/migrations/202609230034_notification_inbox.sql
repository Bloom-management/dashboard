begin;
create table private.notification_dismissals (
 user_id uuid not null references public.users, notification_key text not null,
 dismissed_at timestamptz not null default now(), primary key(user_id,notification_key)
);
-- Inbox lifetime follows the work, independently of the short push delivery TTL.
create function private.inbox_items() returns table(id text,body text,href text,dismissible boolean)
language plpgsql stable security definer set search_path='' as $$
declare u public.users; m private.push_messages; n integer; day date; city text; p jsonb;begin
 u:=private.require_actor();
 if u.role='admin' then
  for p in select value from jsonb_array_elements(public.bloom_admin_pricing()) loop
   id:='pricing:'||(p->>'id');body:=(p->>'name')||' needs cleaner pricing set';href:='/admin?view=properties&property='||(p->>'id')||'&section=settings';dismissible:=false;return next;
  end loop;
  for p in select value from jsonb_array_elements(public.bloom_admin_payouts()->'people') loop
   if (p->>'totalDueCents')::bigint>0 then
    id:='payout:'||(p->>'id');body:=(p->>'name')||' has $'||to_char((p->>'totalDueCents')::numeric/100,'FM999999990.00')||' in outstanding payments';href:='/admin?view=payouts&cleaner='||(p->>'id');dismissible:=false;return next;
   end if;
  end loop;
 end if;
 if u.role in ('owner','admin') then
  return query select 'sync:'||s.id,p.name||' calendar needs attention',case when u.role='admin' then '/admin?view=properties&property='||p.id else '/owner?view=listings' end,false
   from public.calendar_sources s join public.properties p on p.id=s.property_id
   where p.deleted_at is null and p.active and s.enabled and s.last_error_code is not null
   and (u.role='admin' or exists(select 1 from public.property_owners po where po.property_id=p.id and po.owner_id=u.id));
  return query select 'change:'||c.id,p.name||case c.type when 'removed' then ': calendar booking removed.' else ': calendar dates changed.' end,
   case when u.role='admin' then '/admin?view=properties&property='||p.id else '/owner' end,true
   from public.calendar_changes c join public.calendar_events e on e.id=c.event_id join public.calendar_sources s on s.id=e.source_id join public.properties p on p.id=s.property_id
   where c.acknowledged_at is null and c.type in ('changed','removed') and c.created_at>now()-interval '30 days' and e.end_local_date>=current_date
   and p.deleted_at is null and p.active and (u.role='admin' or exists(select 1 from public.property_owners po where po.property_id=p.id and po.owner_id=u.id));
 end if;
 if u.role='cleaner' then
  for m in select * from private.push_messages where user_id=u.id and kind<>'test' and created_at>now()-interval '7 days' order by created_at desc loop
   if m.kind='new' then
    if u.approved_city_id is distinct from m.city_id then continue;end if;
    select count(*),min(j.checkout_date) into n,day from public.jobs j where j.id=any(m.job_ids) and private.push_claimable(j.id,now())
     and not exists(select 1 from public.assignments a where a.job_id=j.id and a.cleaner_id=u.id and a.ended_at is null);
    select name into city from public.cities where public.cities.id=m.city_id;
    body:=n||' new cleaning'||case when n=1 then '' else 's' end||' available in '||city||'.';
    href:='/cleaner?view=calendar&city='||m.city_id||'&date='||day;
   else
    select count(distinct j.id) into n from public.assignments a join public.jobs j on j.id=a.job_id join public.properties p on p.id=j.property_id
     where a.cleaner_id=u.id and a.ended_at is null and a.claimed_at<=m.cutoff and j.status='open' and j.end_at>now() and j.checkout_date=m.job_date
     and p.city_id=m.city_id and p.active and p.deleted_at is null;
    body:=n||' claimed cleaning'||case when n=1 then '' else 's' end||' on '||to_char(m.job_date,'Mon DD')||'.';
    href:='/cleaner?view=upcoming&date='||m.job_date;
   end if;
   if n>0 then id:='push:'||m.id;dismissible:=true;return next;end if;
  end loop;
 end if;
end $$;
create function public.bloom_notification_inbox(p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u public.users;result jsonb;begin
 u:=private.require_actor();if p_offset<0 or p_offset>100000 then raise exception 'VALIDATION_ERROR';end if;
 with visible as (select i.* from private.inbox_items() i where not exists(select 1 from private.notification_dismissals d where d.user_id=u.id and d.notification_key=i.id)),
 page as(select * from visible order by id limit 10 offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'),'total',(select count(*) from visible)) into result;return result;
end $$;
create function public.bloom_notification_dismiss(p_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;begin
 u:=private.require_actor();
 if not exists(select 1 from private.inbox_items() i where i.id=p_id and i.dismissible) then raise exception 'NOT_FOUND';end if;
 insert into private.notification_dismissals(user_id,notification_key) values(u.id,p_id) on conflict do nothing;
 return jsonb_build_object('dismissed',true);
end $$;
revoke all on function private.inbox_items() from public,anon,authenticated;
revoke all on function public.bloom_notification_inbox(integer),public.bloom_notification_dismiss(text) from public,anon;
grant execute on function public.bloom_notification_inbox(integer),public.bloom_notification_dismiss(text) to authenticated;
commit;
