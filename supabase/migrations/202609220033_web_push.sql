begin;
-- Private durable outbox. No client/table access, no schedules or production activation here.
alter table public.cities add column notification_timezone text;
update public.cities set notification_timezone='America/Detroit' where name='Detroit';
create table private.push_control(singleton boolean primary key default true check(singleton), activated_at timestamptz);
insert into private.push_control values(true,null);
create table private.push_preferences(user_id uuid primary key references public.users, new_jobs boolean not null default false, reminders boolean not null default false);
create table private.push_devices(
 id text primary key, user_id uuid references public.users, session_id text, subscription_id uuid unique,
 generation uuid not null default gen_random_uuid(), verified boolean not null default false,
 challenge_hash text, challenge_expires timestamptz, last_test_at timestamptz, updated_at timestamptz not null default now()
);
create table private.push_publications(job_id uuid primary key references public.jobs, batch text not null, city_id uuid not null references public.cities, published_at timestamptz not null default now(), consumed boolean not null default false);
create table private.push_messages(
 id uuid primary key default gen_random_uuid(), logical_key text not null unique, user_id uuid not null references public.users,
 kind text not null check(kind in ('new','evening','morning','test')), city_id uuid references public.cities,
 job_ids uuid[], job_date date, cutoff timestamptz, expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table private.push_deliveries(
 id uuid primary key default gen_random_uuid(), message_id uuid not null references private.push_messages,
 device_id text not null references private.push_devices, generation uuid not null,
 state text not null default 'pending' check(state in ('pending','attempted','accepted','failed','skipped')),
 attempts integer not null default 0, lease uuid, lease_until timestamptz, next_attempt timestamptz not null default now(),
 provider_id uuid, error_code text, updated_at timestamptz not null default now(), unique(message_id,device_id,generation)
);
create index push_due on private.push_deliveries(next_attempt) where state in ('pending','attempted');
create function private.push_claimable(p_job uuid,p_now timestamptz) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.jobs j join public.properties p on p.id=j.property_id join public.cities c on c.id=p.city_id
 where j.id=p_job and j.status='open' and not j.review_required and j.end_at>p_now and p.active and p.deleted_at is null and c.active
 and (select count(*) from public.assignments a where a.job_id=j.id and a.ended_at is null)<2)
$$;
create function private.push_published() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if private.push_claimable(new.id,now()) then
 insert into private.push_publications(job_id,batch,city_id,consumed)
 select new.id,pg_current_xact_id()::text,p.city_id,(select activated_at is null from private.push_control)
 from public.properties p where p.id=new.property_id on conflict do nothing;
 end if;return new;
end $$;
create trigger push_job_published after insert or update on public.jobs for each row execute function private.push_published();
-- Activation is deliberately separate from migrations. Existing jobs are always baselined first.
create function public.bloom_push_activate() returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('bloom-push-tick',0));
 insert into private.push_publications(job_id,batch,city_id,consumed) select j.id,'baseline',p.city_id,true from public.jobs j join public.properties p on p.id=j.property_id on conflict do nothing;
 update private.push_control set activated_at=now() where activated_at is null;
end $$;
create function public.bloom_push_device(p_device text,p_user uuid,p_session text,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.push_devices; m uuid;begin
 if length(p_device)<>64 then raise sqlstate 'PT400' using message='VALIDATION_ERROR';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_device,0));
 select * into d from private.push_devices where id=p_device for update;
 if p_action='detach' then
  update private.push_devices set user_id=null,session_id=null,verified=false,generation=gen_random_uuid(),challenge_hash=null where id=p_device;return '{}';
 end if;
 if not exists(select 1 from public.users where id=p_user and role='cleaner') then raise sqlstate 'PT403' using message='FORBIDDEN';end if;
 if d.id is null then insert into private.push_devices(id,user_id,session_id) values(p_device,p_user,p_session);
 elsif d.user_id is distinct from p_user or d.session_id is distinct from p_session then
  update private.push_devices set user_id=p_user,session_id=p_session,verified=false,generation=gen_random_uuid(),challenge_hash=null where id=p_device;
 end if;
 insert into private.push_preferences(user_id) values(p_user) on conflict do nothing;
 select * into d from private.push_devices where id=p_device;
 if p_action='preferences' then
  update private.push_preferences set new_jobs=(p_input->>'newJobs')::boolean,reminders=(p_input->>'reminders')::boolean where user_id=p_user;
 elsif p_action='challenge' then
  if d.last_test_at>now()-interval '1 minute' then raise sqlstate 'PT409' using message='CONFLICT';end if;
  -- A verified subscription cannot be stolen by merely submitting its ID. Transfer requires a new received proof.
  if exists(select 1 from private.push_devices where subscription_id=(p_input->>'subscription')::uuid and id<>p_device) then raise sqlstate 'PT409' using message='CONFLICT';end if;
  update private.push_devices set subscription_id=(p_input->>'subscription')::uuid,verified=false,challenge_hash=p_input->>'hash',challenge_expires=now()+interval '10 minutes',last_test_at=now(),updated_at=now() where id=p_device;
 elsif p_action='verify' then
  if d.challenge_hash is null or d.challenge_hash<>p_input->>'hash' or d.challenge_expires<now() then raise sqlstate 'PT403' using message='FORBIDDEN';end if;
  update private.push_devices set verified=true,challenge_hash=null,challenge_expires=null,updated_at=now() where id=p_device;
 elsif p_action='disable' then
  update private.push_devices set verified=false,generation=gen_random_uuid(),challenge_hash=null where id=p_device;
 elsif p_action='test' then
  if not d.verified or d.last_test_at>now()-interval '1 minute' then raise sqlstate 'PT409' using message='CONFLICT';end if;
  update private.push_devices set last_test_at=now() where id=p_device;
  insert into private.push_messages(logical_key,user_id,kind,expires_at) values('test:'||p_device||':'||(p_input->>'key'),p_user,'test',now()+interval '5 minutes') on conflict(logical_key) do update set logical_key=excluded.logical_key returning id into m;
  insert into private.push_deliveries(message_id,device_id,generation) values(m,p_device,d.generation) on conflict do nothing;
 elsif p_action<>'status' then raise sqlstate 'PT400' using message='VALIDATION_ERROR';end if;
 return (select jsonb_build_object('testDeliveryId',(select id from private.push_deliveries where message_id=m and device_id=p_device),'verified',x.verified,'pending',x.challenge_hash is not null and x.challenge_expires>now(),'newJobs',s.new_jobs,'reminders',s.reminders) from private.push_devices x join private.push_preferences s on s.user_id=x.user_id where x.id=p_device);
end $$;
-- Re-evaluated at reservation, immediately before provider send, and before showing on a device.
create function private.push_content(p_message uuid,p_now timestamptz) returns jsonb language plpgsql stable set search_path='' as $$
declare m private.push_messages; n integer; first_date date; city text; u public.users;s private.push_preferences;begin
 select * into m from private.push_messages where id=p_message;
 select * into u from public.users where id=m.user_id;
 select * into s from private.push_preferences where user_id=m.user_id;
 if m.id is null or m.expires_at<=p_now or u.role<>'cleaner' then return null;end if;
 if m.kind='test' then return jsonb_build_object('body','Notifications are enabled on this device.','url','/cleaner?notifications=1');end if;
 select name into city from public.cities where id=m.city_id and active;
 if city is null then return null;end if;
 if m.kind='new' then
  if not coalesce(s.new_jobs,false) or u.approved_city_id is distinct from m.city_id then return null;end if;
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
 'url',case when m.kind='new' then '/cleaner?view=calendar&city='||m.city_id||'&date='||first_date else '/cleaner?view=upcoming&date='||m.job_date end,'count',n);
end $$;
create function public.bloom_push_tick(p_now timestamptz default now()) returns integer language plpgsql security definer set search_path='' as $$
declare c record; scheduled_at timestamptz; local_day date; k text; n integer;begin
 perform pg_advisory_xact_lock(hashtextextended('bloom-push-tick',0));
 if (select activated_at is null from private.push_control) then return 0;end if;
 insert into private.push_messages(logical_key,user_id,kind,city_id,job_ids,expires_at)
 select 'new:'||b.batch||':'||b.city_id||':'||u.id,u.id,'new',b.city_id,b.ids,p_now+interval '1 hour'
 from (select batch,city_id,array_agg(job_id) ids from private.push_publications where not consumed and published_at>=p_now-interval '1 hour' group by batch,city_id) b
 join public.users u on u.role='cleaner' and u.approved_city_id=b.city_id join private.push_preferences s on s.user_id=u.id and s.new_jobs
 on conflict do nothing;
 update private.push_publications set consumed=true where not consumed;
 for c in select * from public.cities where active and notification_timezone is not null loop
  local_day:=(p_now at time zone c.notification_timezone)::date;
  foreach k in array array['evening','morning'] loop
   scheduled_at:=(local_day+case when k='evening' then time '18:00' else time '08:00' end) at time zone c.notification_timezone;
   if p_now>=scheduled_at and p_now<scheduled_at+interval '10 minutes' then
    insert into private.push_messages(logical_key,user_id,kind,city_id,job_date,cutoff,expires_at)
    select k||':'||c.id||':'||local_day||':'||u.id,u.id,k,c.id,local_day+case when k='evening' then 1 else 0 end,scheduled_at,scheduled_at+interval '10 minutes'
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
create function public.bloom_push_take(p_limit integer default 10,p_only uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare r record;out jsonb:='[]';begin
 update private.push_deliveries set state='failed',error_code='TRANSIENT',updated_at=now() where state in ('pending','attempted') and attempts>=4 and (lease_until is null or lease_until<=now());
 update private.push_deliveries d set state='skipped',error_code='EXPIRED' from private.push_messages m where m.id=d.message_id and m.expires_at<=now() and d.state in ('pending','attempted') and (d.lease_until is null or d.lease_until<=now());
 for r in select d.* from private.push_deliveries d join private.push_messages m on m.id=d.message_id
 where (p_only is null or d.id=p_only) and d.state in ('pending','attempted') and d.attempts<4 and d.next_attempt<=now() and (d.lease_until is null or d.lease_until<=now()) and m.expires_at>now()
 order by d.next_attempt for update of d skip locked limit least(greatest(p_limit,1),20) loop
  update private.push_deliveries set state='attempted',attempts=attempts+1,lease=gen_random_uuid(),lease_until=now()+interval '2 minutes',updated_at=now() where id=r.id;
  out:=out||(select jsonb_build_object('id',id,'lease',lease,'attempts',attempts) from private.push_deliveries where id=r.id);
 end loop;return out;
end $$;
create function public.bloom_push_delivery(p_id uuid,p_lease uuid default null,p_device text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare x record;content jsonb;begin
 select d.*,v.user_id,v.session_id,v.subscription_id,u.clerk_user_id,m.expires_at,m.kind into x from private.push_deliveries d
 join private.push_devices v on v.id=d.device_id and v.generation=d.generation and v.verified
 join private.push_messages m on m.id=d.message_id and m.user_id=v.user_id join public.users u on u.id=v.user_id
 where d.id=p_id and ((p_lease is not null and d.lease=p_lease and d.lease_until>now() and d.state='attempted') or (p_device is not null and d.device_id=p_device and d.state in ('attempted','accepted')));
 if not found then return null;end if;
 content:=private.push_content(x.message_id,now());if content is null then return null;end if;
 return jsonb_build_object('subscription',x.subscription_id,'session',x.session_id,'subject',x.clerk_user_id,'userId',x.user_id,'expiresAt',x.expires_at,'kind',x.kind,'content',content);
end $$;
create function public.bloom_push_finish(p_id uuid,p_lease uuid,p_state text,p_provider uuid default null,p_error text default null,p_invalid boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare d private.push_deliveries;begin
 if p_state not in ('pending','accepted','failed','skipped') or (p_error is not null and p_error not in ('TRANSIENT','PROVIDER_REJECTED','SUBSCRIPTION_EXPIRED','SESSION_ENDED','INELIGIBLE','TEST_ONLY','EXPIRED')) then raise sqlstate 'PT400' using message='VALIDATION_ERROR';end if;
 select * into d from private.push_deliveries where id=p_id and lease=p_lease and state='attempted' for update;
 if not found then return;end if;
 update private.push_deliveries set state=case when p_state='pending' and attempts>=4 then 'failed' else p_state end,provider_id=p_provider,error_code=p_error,lease_until=null,next_attempt=now()+make_interval(secs=>least(240,30*(2^attempts)::integer)),updated_at=now() where id=p_id;
 if p_invalid then update private.push_devices set verified=false where id=d.device_id and generation=d.generation;end if;
end $$;
create function public.bloom_push_history(p_user uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x),'[]') from (select m.id,m.kind,m.job_date as date,d.state,d.attempts,d.error_code as error,d.updated_at as updated_at,
 case when p_user is not null then private.push_content(m.id,least(now(),m.expires_at-interval '1 second')) else null end as content
 from private.push_deliveries d join private.push_messages m on m.id=d.message_id where p_user is null or m.user_id=p_user order by d.updated_at desc limit 50) x
$$;
revoke all on all tables in schema private from public,anon,authenticated;
revoke all on function private.push_claimable(uuid,timestamptz),private.push_published(),private.push_content(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.bloom_push_activate(),public.bloom_push_device(text,uuid,text,text,jsonb),public.bloom_push_tick(timestamptz),public.bloom_push_take(integer,uuid),public.bloom_push_delivery(uuid,uuid,text),public.bloom_push_finish(uuid,uuid,text,uuid,text,boolean),public.bloom_push_history(uuid) from public,anon,authenticated;
grant execute on function public.bloom_push_activate(),public.bloom_push_device(text,uuid,text,text,jsonb),public.bloom_push_tick(timestamptz),public.bloom_push_take(integer,uuid),public.bloom_push_delivery(uuid,uuid,text),public.bloom_push_finish(uuid,uuid,text,uuid,text,boolean),public.bloom_push_history(uuid) to service_role;
commit;
