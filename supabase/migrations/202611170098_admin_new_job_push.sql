begin;
-- New-job alerts also reach admins who enabled "New jobs". Cleaner eligibility is unchanged
-- (Bloom network, approved city). Admins have global property access, so city is not required.

-- Base content function (renamed in 052); later wrappers shorten the copy for every recipient.
create or replace function private.push_content_before_completion(p_message uuid,p_now timestamptz) returns jsonb language plpgsql stable set search_path='' as $$
declare m private.push_messages; n integer; first_date date; city text; u public.users;s private.push_preferences;begin
 select * into m from private.push_messages where id=p_message;
 select * into u from public.users where id=m.user_id;
 select * into s from private.push_preferences where user_id=m.user_id;
 if m.id is null or m.expires_at<=p_now then return null;end if;
 if u.role<>'cleaner' and not (u.role='admin' and m.kind='new') then return null;end if;
 if m.kind='test' then return jsonb_build_object('body','Notifications are enabled on this device.','url','/cleaner?notifications=1');end if;
 select name into city from public.cities where id=m.city_id;
 if city is null then return null;end if;
 if m.kind='new' then
  if not exists(select 1 from public.cities where id=m.city_id and active) or not coalesce(s.new_jobs,false) then return null;end if;
  if u.role='cleaner' and (not u.bloom_network_enabled or u.approved_city_id is distinct from m.city_id) then return null;end if;
  select count(*),min(j.checkout_date) into n,first_date from public.jobs j where j.id=any(m.job_ids) and private.push_claimable(j.id,p_now)
   and not exists(select 1 from public.assignments a where a.job_id=j.id and a.cleaner_id=u.id and a.ended_at is null);
 else
  if not coalesce(s.reminders,false) then return null;end if;
  select count(distinct j.id) into n from public.jobs j join public.properties p on p.id=j.property_id join public.assignments a on a.job_id=j.id
   where p.city_id=m.city_id and p.active and p.deleted_at is null and j.status='open' and j.end_at>p_now and j.checkout_date=m.job_date
   and a.cleaner_id=u.id and a.ended_at is null and a.claimed_at<=m.cutoff;
 end if;
 if n=0 then return null;end if;
 return jsonb_build_object('body',case when m.kind='new' then n||' new cleaning'||case when n=1 then '' else 's' end||' available in '||city||'. Tap to view.'
 else 'You have '||n||' cleaning'||case when n=1 then '' else 's' end||case when m.kind='evening' then ' tomorrow. Tap to view your jobs.' else ' today. Tap to view your schedule.' end end,
 'url',case when m.kind='new' and u.role='admin' then '/admin?view=jobs&date='||first_date
  when m.kind='new' then '/cleaner?view=calendar&city='||m.city_id||'&date='||first_date
  else '/cleaner?view=upcoming&date='||m.job_date end,'count',n);
end $$;

-- Legacy tick body (wrapped by bloom_push_tick since 080): add admin recipients for new-job batches.
create or replace function public.bloom_push_tick_before_operations(p_now timestamptz default now()) returns integer language plpgsql security definer set search_path='' as $$
declare c record; scheduled_at timestamptz; local_day date; k text; n integer;begin
 perform pg_advisory_xact_lock(hashtextextended('bloom-push-tick',0));
 update private.push_control set last_tick_at=p_now where singleton=true;
 if (select activated_at is null from private.push_control) then return 0;end if;
 insert into private.push_messages(logical_key,user_id,kind,city_id,job_ids,expires_at)
 select 'new:'||b.batch||':'||b.city_id||':'||u.id,u.id,'new',b.city_id,b.ids,p_now+interval '1 hour'
 from (select batch,city_id,array_agg(job_id) ids from private.push_publications where not consumed and published_at>=p_now-interval '1 hour' group by batch,city_id) b
 join public.users u on (u.role='cleaner' and u.bloom_network_enabled and u.approved_city_id=b.city_id) or u.role='admin'
 join private.push_preferences s on s.user_id=u.id and s.new_jobs
 on conflict do nothing;
 update private.push_publications set consumed=true where not consumed;
 for c in select * from public.cities where notification_timezone is not null loop
  local_day:=(p_now at time zone c.notification_timezone)::date;
  foreach k in array array['evening','morning'] loop
   scheduled_at:=(local_day+case when k='evening' then time '18:00' else time '08:00' end) at time zone c.notification_timezone;
   if p_now>=scheduled_at and p_now<scheduled_at+interval '1 hour' then
    insert into private.push_messages(logical_key,user_id,kind,city_id,job_date,cutoff,expires_at)
    select k||':'||c.id||':'||local_day||':'||u.id,u.id,k,c.id,local_day+case when k='evening' then 1 else 0 end,scheduled_at,scheduled_at+interval '1 hour'
    from public.users u join private.push_preferences s on s.user_id=u.id and s.reminders where u.role='cleaner' and exists(
     select 1 from public.assignments a join public.jobs j on j.id=a.job_id join public.properties p on p.id=j.property_id
     where a.cleaner_id=u.id and a.ended_at is null and a.claimed_at<=scheduled_at and p.city_id=c.id and j.status='open' and j.checkout_date=local_day+case when k='evening' then 1 else 0 end)
    on conflict do nothing;
   end if;
  end loop;
 end loop;
 insert into private.push_deliveries(message_id,device_id,generation)
 select m.id,d.id,d.generation from private.push_messages m join private.push_device_accounts a on a.user_id=m.user_id and a.enabled join private.push_devices d on d.id=a.device_id and d.verified
 where m.kind<>'test' and m.expires_at>p_now and d.updated_at<=m.created_at and a.linked_at<=m.created_at and private.push_content(m.id,p_now) is not null on conflict do nothing;
 get diagnostics n=row_count;return n;
end $$;
revoke all on function public.bloom_push_tick_before_operations(timestamptz) from public,anon,authenticated,service_role;
commit;
