begin;
-- Job alerts name the day relative to the property-local week (Monday start):
-- "this Wednesday (Nov 18)", "next Monday (Nov 23)", otherwise "Thursday (Jun 10)" (+ year if different).
create or replace function private.push_day_label(p_day date,p_today date) returns text language sql immutable set search_path='' as $$
 select case when date_trunc('week',p_day)=date_trunc('week',p_today) then 'this '
  when date_trunc('week',p_day)=date_trunc('week',p_today)+interval '7 days' then 'next ' else '' end
  ||to_char(p_day,'FMDay')||' ('||to_char(p_day,case when extract(year from p_day)=extract(year from p_today) then 'Mon FMDD' else 'Mon FMDD, YYYY' end)||')';
$$;
revoke all on function private.push_day_label(date,date) from public,anon,authenticated,service_role;

do $$declare definition text;changed text;begin
 -- New-job copy (concise wrapper from 060, renamed by 062).
 definition:=pg_get_functiondef('private.push_content_before_handoff(uuid,timestamptz)'::regprocedure);
 changed:=replace(definition,$n$to_char(day,'Mon FMDD, YYYY')$n$,
  $r$private.push_day_label(day,(select (p_now at time zone x.timezone_snapshot)::date from public.jobs x where x.id=any(m.job_ids) and x.checkout_date=day limit 1))$r$);
 if changed=definition then raise exception 'new-job copy not found';end if;
 execute changed;

 -- Unclaimed/available copy; admins may also receive unclaimed alerts (all cities, admin jobs view).
 definition:=pg_get_functiondef('private.notification_content_before_freshness(uuid,timestamptz,boolean)'::regprocedure);
 changed:=replace(definition,
  $n$case when first_day=(p_now at time zone (select timezone_snapshot from public.jobs where id=ids[1]))::date+1 then 'tomorrow' else to_char(first_day,'Mon FMDD') end$n$,
  $r$private.push_day_label(first_day,(p_now at time zone (select timezone_snapshot from public.jobs where id=ids[1]))::date)$r$);
 changed:=replace(changed,
  $n$if u.role<>'cleaner' or not u.bloom_network_enabled or not u.bloom_pool_approved then return null;end if;$n$,
  $r$if not (u.role='admin' and e.kind='unclaimed') and (u.role<>'cleaner' or not u.bloom_network_enabled or not u.bloom_pool_approved) then return null;end if;$r$);
 changed:=replace(changed,$n$and prop.city_id=u.approved_city_id$n$,$r$and (u.role='admin' or prop.city_id=u.approved_city_id)$r$);
 changed:=replace(changed,
  $n$'url','/cleaner?view=calendar&city='||u.approved_city_id||'&date='||first_day,'count',n);$n$,
  $r$'url',case when u.role='admin' then '/admin?view=jobs&date='||first_day else '/cleaner?view=calendar&city='||u.approved_city_id||'&date='||first_day end,'count',n);$r$);
 if position($n$u.role='admin' and e.kind='unclaimed'$n$ in changed)=0 or position($n$'/admin?view=jobs&date='||first_day$n$ in changed)=0 or position('push_day_label' in changed)=0 then raise exception 'unclaimed patch incomplete';end if;
 execute changed;
end $$;

-- Operator override: link an account to every verified device already linked to another account
-- (both owned by the same person). Normal enrollment still requires the on-device flow.
create function public.bloom_push_link_account_devices(p_source uuid,p_target uuid) returns integer language plpgsql security definer set search_path='' as $$
declare n integer;begin
 if p_source is null or p_target is null or p_source=p_target or not exists(select 1 from public.users where id=p_target) then raise sqlstate 'PT400' using message='VALIDATION_ERROR';end if;
 insert into private.push_preferences(user_id) values(p_target) on conflict do nothing;
 update private.push_preferences set push_enabled=true where user_id=p_target;
 insert into private.push_device_accounts(device_id,user_id,enabled,linked_at)
 select a.device_id,p_target,true,now() from private.push_device_accounts a join private.push_devices d on d.id=a.device_id and d.verified where a.user_id=p_source and a.enabled
 on conflict(device_id,user_id) do update set enabled=true,linked_at=now();
 get diagnostics n=row_count;return n;
end $$;
revoke all on function public.bloom_push_link_account_devices(uuid,uuid) from public,anon,authenticated;
grant execute on function public.bloom_push_link_account_devices(uuid,uuid) to service_role;

-- Operator send of one job alert ('new' or 'unclaimed') to one account; the next tick delivers it
-- under the normal content, preference and device checks.
create function public.bloom_push_send_to(p_user uuid,p_kind text,p_jobs uuid[]) returns boolean language plpgsql security definer set search_path='' as $$
declare run text:=p_kind||':operator:'||now()||':'||p_user;city uuid;begin
 if p_kind not in ('new','unclaimed') or cardinality(p_jobs) is null or not exists(select 1 from public.users where id=p_user) then raise sqlstate 'PT400' using message='VALIDATION_ERROR';end if;
 if p_kind='new' then
  select p.city_id into city from public.jobs j join public.properties p on p.id=j.property_id where j.id=p_jobs[1];
  insert into private.push_messages(logical_key,user_id,kind,city_id,job_ids,expires_at) values(run,p_user,'new',city,p_jobs,now()+interval '1 hour');
 else
  perform private.notification_emit(run,p_user,'unclaimed','unclaimed',null,null,jsonb_build_object('jobs',to_jsonb(p_jobs)),now()+interval '24 hours');
 end if;
 return true;
end $$;
revoke all on function public.bloom_push_send_to(uuid,text,uuid[]) from public,anon,authenticated;
grant execute on function public.bloom_push_send_to(uuid,text,uuid[]) to service_role;
commit;
