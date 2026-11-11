begin;
-- Existing preference rows are user choices, even when every category is off.
alter table private.push_preferences add column push_enabled boolean not null default false,
 add column initialized boolean not null default false;
update private.push_preferences s set initialized=true,push_enabled=exists(
 select 1 from private.push_device_accounts a join private.push_devices d on d.id=a.device_id
 where a.user_id=s.user_id and a.enabled and d.verified);
-- Replace the historical wrappers as well as the implicit enrollment behavior.
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
 -- Viewing settings must never enroll an account. Only explicit authenticated actions link it.
 update private.push_devices set challenge_hash=null,challenge_expires=null
 where id=p_device and challenge_expires<=now();
 if p_action='link' then
  if not d.verified then raise sqlstate 'PT409' using message='CONFLICT';end if;
  insert into private.push_device_accounts(device_id,user_id) values(p_device,p_user)
  on conflict(device_id,user_id) do update set enabled=true,linked_at=now() where not private.push_device_accounts.enabled;
 elsif p_action='unlink' then
  update private.push_device_accounts set enabled=false where device_id=p_device and user_id=p_user;
 elsif p_action='preferences' then
  perform 1 from private.push_preferences where user_id=p_user for update;
  if coalesce((p_input->>'pushEnabled')::boolean,false) then
   update private.push_preferences set new_jobs=(select role='cleaner' and bloom_network_enabled from public.users where id=p_user),
    reminders=true,completions=true,starts=true,low_supplies=true,maintenance=true,initialized=true
   where user_id=p_user and not initialized;
  end if;
  update private.push_preferences set
   push_enabled=coalesce((p_input->>'pushEnabled')::boolean,push_enabled),
   new_jobs=coalesce((p_input->>'newJobs')::boolean,new_jobs),reminders=coalesce((p_input->>'reminders')::boolean,reminders),
   completions=coalesce((p_input->>'completions')::boolean,completions),starts=coalesce((p_input->>'starts')::boolean,starts),
   low_supplies=coalesce((p_input->>'lowSupplies')::boolean,low_supplies),maintenance=coalesce((p_input->>'maintenance')::boolean,maintenance)
  where user_id=p_user;
  -- Permanently suppress queued work, including retries after a rapid off/on cycle.
  if p_input->>'pushEnabled'='false' then
   update private.push_deliveries v set state='skipped',error_code='ACCOUNT_DISABLED',lease=null,lease_until=null
   from private.push_messages msg where v.message_id=msg.id and msg.user_id=p_user and v.state in ('pending','attempted');
  end if;
 elsif p_action='cancelChallenge' then
  update private.push_devices set challenge_hash=null,challenge_expires=null where id=p_device and user_id=p_user and session_id=p_session and challenge_hash=p_input->>'hash';
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
 return (select jsonb_build_object('testDeliveryId',(select id from private.push_deliveries where message_id=m and device_id=p_device),'subscriptionId',x.subscription_id,'verified',x.verified,'linked',coalesce(a.enabled,false),'pending',x.challenge_hash is not null and x.challenge_expires>now(),'newJobs',s.new_jobs,'reminders',s.reminders,'completions',s.completions,'starts',s.starts,'lowSupplies',s.low_supplies,'maintenance',s.maintenance,'pushEnabled',s.push_enabled) from private.push_devices x join private.push_preferences s on s.user_id=p_user left join private.push_device_accounts a on a.device_id=x.id and a.user_id=p_user where x.id=p_device);
end $$;

revoke all on function public.bloom_push_device(text,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.bloom_push_device(text,uuid,text,text,jsonb) to service_role;
-- Keep inbox generation independent. Only dispatch consults the account master.
alter function public.bloom_push_delivery(uuid,uuid,text) rename to bloom_push_delivery_before_account_preferences;
revoke all on function public.bloom_push_delivery_before_account_preferences(uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.bloom_push_delivery(p_id uuid,p_lease uuid default null,p_device text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if p_lease is not null and not exists(
  select 1 from private.push_deliveries d join private.push_messages m on m.id=d.message_id
  join private.push_preferences s on s.user_id=m.user_id and s.push_enabled where d.id=p_id
 ) then return null;end if;
 return public.bloom_push_delivery_before_account_preferences(p_id,p_lease,p_device);
end $$;
revoke all on function public.bloom_push_delivery(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.bloom_push_delivery(uuid,uuid,text) to service_role;
commit;
