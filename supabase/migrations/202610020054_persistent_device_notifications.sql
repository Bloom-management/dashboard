begin;
-- Receipt belongs to a physical browser/PWA; account subscriptions survive logout.
create table private.push_device_accounts(
 device_id text not null references private.push_devices(id) on delete cascade,
 user_id uuid not null references public.users(id) on delete cascade,
 enabled boolean not null default true,
 linked_at timestamptz not null default now(),
 primary key(device_id,user_id)
);
revoke all on private.push_device_accounts from public,anon,authenticated,service_role;
-- Preserve proven registrations, never revive unverified or disabled devices.
insert into private.push_device_accounts(device_id,user_id,linked_at)
 select id,user_id,updated_at from private.push_devices where verified and user_id is not null;
create or replace function public.bloom_push_device(p_device text,p_user uuid,p_session text,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.push_devices; m uuid;begin
 if p_device is null or p_device !~ '^[a-f0-9]{64}$' then raise sqlstate 'PT400' using message='VALIDATION_ERROR';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_device,0));
 select * into d from private.push_devices where id=p_device for update;
 if p_action='reconcile' then return '{}';end if; -- Signing out never revokes device consent.
 if p_action in ('detach','disable') then
  update private.push_devices set verified=false,generation=gen_random_uuid(),challenge_hash=null,challenge_expires=null where id=p_device;
  update private.push_device_accounts set enabled=false where device_id=p_device;
  return '{}';
 end if;
 if p_session is null or not exists(select 1 from public.users where id=p_user and role in ('cleaner','owner','admin')) then raise sqlstate 'PT403' using message='FORBIDDEN';end if;
 if d.id is null then insert into private.push_devices(id,user_id,session_id) values(p_device,p_user,p_session);
 end if;
 insert into private.push_preferences(user_id) values(p_user) on conflict do nothing;
 select * into d from private.push_devices where id=p_device;
 -- Once receipt is verified, an authenticated sign-in adds this account without
 -- another push challenge. Explicitly stopped accounts remain stopped on reload.
 if d.verified then
  insert into private.push_device_accounts(device_id,user_id) values(p_device,p_user) on conflict do nothing;
 end if;
 if p_action='link' then
  if not d.verified then raise sqlstate 'PT409' using message='CONFLICT';end if;
  insert into private.push_device_accounts(device_id,user_id) values(p_device,p_user)
  on conflict(device_id,user_id) do update set enabled=true,linked_at=now() where not private.push_device_accounts.enabled;
 elsif p_action='unlink' then
  update private.push_device_accounts set enabled=false where device_id=p_device and user_id=p_user;
 elsif p_action='preferences' then
  update private.push_preferences set new_jobs=(p_input->>'newJobs')::boolean,reminders=(p_input->>'reminders')::boolean,completions=coalesce((p_input->>'completions')::boolean,completions) where user_id=p_user;
 elsif p_action='challenge' then
  if d.last_test_at>now()-interval '1 minute' then raise sqlstate 'PT409' using message='CONFLICT';end if;
  -- A verified subscription cannot be stolen by merely submitting its ID. Transfer requires a new received proof.
  if exists(select 1 from private.push_devices where subscription_id=(p_input->>'subscription')::uuid and id<>p_device) then raise sqlstate 'PT409' using message='CONFLICT';end if;
  update private.push_devices set user_id=p_user,session_id=p_session,generation=gen_random_uuid(),subscription_id=(p_input->>'subscription')::uuid,verified=false,challenge_hash=p_input->>'hash',challenge_expires=now()+interval '10 minutes',last_test_at=now(),updated_at=now() where id=p_device;
 elsif p_action='verify' then
  if d.user_id is distinct from p_user or d.session_id is distinct from p_session or d.challenge_hash is null or d.challenge_hash is distinct from p_input->>'hash' or d.challenge_expires is null or d.challenge_expires<now() then raise sqlstate 'PT403' using message='FORBIDDEN';end if;
  update private.push_devices set verified=true,challenge_hash=null,challenge_expires=null,updated_at=now() where id=p_device;
  insert into private.push_device_accounts(device_id,user_id) values(p_device,p_user)
  on conflict(device_id,user_id) do update set enabled=true,linked_at=now();
 elsif p_action='test' then
  if not d.verified or not exists(select 1 from private.push_device_accounts where device_id=p_device and user_id=p_user and enabled) or d.last_test_at>now()-interval '1 minute' then raise sqlstate 'PT409' using message='CONFLICT';end if;
  update private.push_devices set last_test_at=now() where id=p_device;
  insert into private.push_messages(logical_key,user_id,kind,expires_at) values('test:'||p_device||':'||(p_input->>'key'),p_user,'test',now()+interval '5 minutes') on conflict(logical_key) do update set logical_key=excluded.logical_key returning id into m;
  insert into private.push_deliveries(message_id,device_id,generation) values(m,p_device,d.generation) on conflict do nothing;
 elsif p_action<>'status' then raise sqlstate 'PT400' using message='VALIDATION_ERROR';end if;
 return (select jsonb_build_object('testDeliveryId',(select id from private.push_deliveries where message_id=m and device_id=p_device),'verified',x.verified,'linked',coalesce(a.enabled,false),'pending',x.challenge_hash is not null and x.challenge_expires>now(),'newJobs',s.new_jobs,'reminders',s.reminders,'completions',s.completions) from private.push_devices x join private.push_preferences s on s.user_id=p_user left join private.push_device_accounts a on a.device_id=x.id and a.user_id=p_user where x.id=p_device);
end $$;

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
 select m.id,d.id,d.generation from private.push_messages m join private.push_device_accounts a on a.user_id=m.user_id and a.enabled join private.push_devices d on d.id=a.device_id and d.verified
 where m.kind<>'test' and m.expires_at>p_now and d.updated_at<=m.created_at and a.linked_at<=m.created_at and private.push_content(m.id,p_now) is not null on conflict do nothing;
 get diagnostics n=row_count;return n;
end $$;
create or replace function public.bloom_push_delivery(p_id uuid,p_lease uuid default null,p_device text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare x record;content jsonb;begin
 select d.*,m.user_id,v.session_id,v.subscription_id,u.clerk_user_id,m.expires_at,m.kind into x from private.push_deliveries d
 join private.push_devices v on v.id=d.device_id and v.generation=d.generation and v.verified
 join private.push_messages m on m.id=d.message_id
 join private.push_device_accounts a on a.device_id=v.id and a.user_id=m.user_id and a.enabled and a.linked_at<=m.created_at
 join public.users u on u.id=m.user_id
 where d.id=p_id and ((p_lease is not null and d.lease=p_lease and d.lease_until>now() and d.state='attempted') or (p_device is not null and d.device_id=p_device and d.state in ('attempted','accepted')));
 if not found then return null;end if;
 content:=private.push_content(x.message_id,now());if content is null then return null;end if;
 content:=jsonb_set(content,'{body}',to_jsonb('['||(select initcap(role::text) from public.users where id=x.user_id)||'] '||(content->>'body')));
 return jsonb_build_object('subscription',x.subscription_id,'session',x.session_id,'subject',x.clerk_user_id,'userId',x.user_id,'expiresAt',x.expires_at,'kind',x.kind,'content',content);
end $$;
commit;
