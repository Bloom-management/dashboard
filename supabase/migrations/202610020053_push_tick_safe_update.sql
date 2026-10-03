-- Production PostgREST enables safeupdate; target the singleton explicitly.
begin;
create or replace function public.bloom_push_tick(p_now timestamptz default now()) returns integer language plpgsql security definer set search_path='' as $$
declare c record; scheduled_at timestamptz; local_day date; k text; n integer;begin
 perform pg_advisory_xact_lock(hashtextextended('bloom-push-tick',0));
 update private.push_control set last_tick_at=p_now where singleton=true;
 if (select activated_at is null from private.push_control) then return 0;end if;
 insert into private.push_messages(logical_key,user_id,kind,city_id,job_ids,expires_at)
 select 'new:'||b.batch||':'||b.city_id||':'||u.id,u.id,'new',b.city_id,b.ids,p_now+interval '1 hour'
 from (select batch,city_id,array_agg(job_id) ids from private.push_publications where not consumed and published_at>=p_now-interval '1 hour' group by batch,city_id) b
 join public.users u on u.role='cleaner' and u.bloom_network_enabled and u.approved_city_id=b.city_id join private.push_preferences s on s.user_id=u.id and s.new_jobs
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
 select m.id,d.id,d.generation from private.push_messages m join private.push_devices d on d.user_id=m.user_id and d.verified
 where m.kind<>'test' and m.expires_at>p_now and d.updated_at<=m.created_at and private.push_content(m.id,p_now) is not null on conflict do nothing;
 get diagnostics n=row_count;return n;
end $$;
commit;
