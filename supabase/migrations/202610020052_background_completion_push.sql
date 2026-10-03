begin;
-- Durable completion delivery; activation is a separate operational release step.
alter table private.push_preferences add column completions boolean not null default true;
alter table private.push_messages drop constraint push_messages_kind_check;
alter table private.push_messages add constraint push_messages_kind_check check(kind in ('new','evening','morning','test','completion'));
alter table private.push_control add column last_tick_at timestamptz;
create or replace function public.bloom_push_device(p_device text,p_user uuid,p_session text,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.push_devices; m uuid;begin
 if length(p_device)<>64 then raise sqlstate 'PT400' using message='VALIDATION_ERROR';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_device,0));
 select * into d from private.push_devices where id=p_device for update;
 if p_action in ('detach','reconcile') then
  update private.push_devices set user_id=null,session_id=null,verified=false,generation=gen_random_uuid(),challenge_hash=null where id=p_device and (p_action='detach' or session_id is distinct from p_session);return '{}';
 end if;
 if not exists(select 1 from public.users where id=p_user and role in ('cleaner','owner','admin')) then raise sqlstate 'PT403' using message='FORBIDDEN';end if;
 if d.id is null then insert into private.push_devices(id,user_id,session_id) values(p_device,p_user,p_session);
 elsif d.user_id is distinct from p_user or d.session_id is distinct from p_session then
  update private.push_devices set user_id=p_user,session_id=p_session,verified=false,generation=gen_random_uuid(),challenge_hash=null where id=p_device;
 end if;
 insert into private.push_preferences(user_id) values(p_user) on conflict do nothing;
 select * into d from private.push_devices where id=p_device;
 if p_action='preferences' then
  update private.push_preferences set new_jobs=(p_input->>'newJobs')::boolean,reminders=(p_input->>'reminders')::boolean,completions=coalesce((p_input->>'completions')::boolean,completions) where user_id=p_user;
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
 return (select jsonb_build_object('testDeliveryId',(select id from private.push_deliveries where message_id=m and device_id=p_device),'verified',x.verified,'pending',x.challenge_hash is not null and x.challenge_expires>now(),'newJobs',s.new_jobs,'reminders',s.reminders,'completions',s.completions) from private.push_devices x join private.push_preferences s on s.user_id=x.user_id where x.id=p_device);
end $$;

alter function private.push_content(uuid,timestamptz) rename to push_content_before_completion;
create function private.push_content(p_message uuid,p_now timestamptz) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m private.push_messages;u public.users;j public.jobs;label text;begin
 select * into m from private.push_messages where id=p_message;
 select * into u from public.users where id=m.user_id;
 if m.id is null or m.expires_at<=p_now or u.id is null then return null;end if;
 if m.kind='test' then return jsonb_build_object('body','Notifications are enabled on this device.','url','/'||u.role||'?notifications=1');end if;
 if m.kind<>'completion' then return private.push_content_before_completion(p_message,p_now);end if;
 if not exists(select 1 from private.push_preferences where user_id=u.id and completions) then return null;end if;
 select * into j from public.jobs where id=m.job_ids[1] and status='completed';
 if j.id is null then return null;end if;
 if not (u.role='admin' or (u.role='owner' and exists(select 1 from public.property_owners where property_id=j.property_id and owner_id=u.id))
  or (u.role='cleaner' and exists(select 1 from public.assignments where job_id=j.id and cleaner_id=u.id and ended_at is null and completed_pay_cents is not null))) then return null;end if;
 select name into label from public.properties where id=j.property_id;
 return jsonb_build_object('body','Cleaning completed at '||label||'. Tap to view details.',
 'url',case when u.role='cleaner' then '/cleaner?view=payouts' else '/'||u.role||'?view=activity&job='||j.id end,'count',1);
end$$;
revoke all on function private.push_content(uuid,timestamptz) from public,anon,authenticated,service_role;

-- Snapshot recipients at completion, in the same transaction as the saved photos/earnings.
create function private.queue_completion_push() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (select activated_at is null from private.push_control) then return new;end if;
 insert into private.push_messages(logical_key,user_id,kind,job_ids,expires_at)
 select 'completion:'||new.job_id||':'||u.id,u.id,'completion',array[new.job_id],new.completed_at+interval '24 hours'
 from public.jobs j join public.users u on (u.role='admin'
  or (u.role='owner' and exists(select 1 from public.property_owners where property_id=j.property_id and owner_id=u.id))
  or (u.role='cleaner' and exists(select 1 from public.assignments where job_id=j.id and cleaner_id=u.id and ended_at is null)))
 join private.push_preferences s on s.user_id=u.id and s.completions
 where j.id=new.job_id on conflict(logical_key) do nothing;
 return new;
end$$;
revoke all on function private.queue_completion_push() from public,anon,authenticated,service_role;
create trigger queue_completion_push after insert on private.cleaning_activity_events for each row execute function private.queue_completion_push();

-- One-hour retry window tolerates temporary scheduler/provider downtime, without day-late reminders.
create or replace function public.bloom_push_tick(p_now timestamptz default now()) returns integer language plpgsql security definer set search_path='' as $$
declare c record; scheduled_at timestamptz; local_day date; k text; n integer;begin
 perform pg_advisory_xact_lock(hashtextextended('bloom-push-tick',0));
 update private.push_control set last_tick_at=p_now;
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
create function public.bloom_push_health() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('activated',activated_at is not null,'lastTickAt',last_tick_at,
 'verifiedDevices',(select count(*) from private.push_devices where verified),
 'pendingDeliveries',(select count(*) from private.push_deliveries where state in ('pending','attempted')))
 from private.push_control;
$$;
revoke all on function public.bloom_push_tick(timestamptz),public.bloom_push_health() from public,anon,authenticated;
grant execute on function public.bloom_push_tick(timestamptz),public.bloom_push_health() to service_role;
commit;
