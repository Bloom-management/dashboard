begin;
-- No activation, preference rewrite, or loss of proven OneSignal registrations.
alter table private.push_devices
 add column transport text not null default 'onesignal' check(transport in ('onesignal','native')),
 add column native_subscription text,
 add column native_endpoint_hash text unique,
 add column native_fingerprint text,
 add column onesignal_verified boolean not null default false,
 add column enrollment_hash text,
 add column enrollment_user uuid,
 add column enrollment_session text,
 add column enrollment_generation uuid,
 add column enrollment_expires timestamptz,
 add column enrollment_started timestamptz;
update private.push_devices set onesignal_verified=verified,challenge_hash=null,challenge_expires=null;
alter table private.push_deliveries
 add column transport text not null default 'onesignal' check(transport in ('onesignal','native')),
 add column display_token_hash text;

-- One logical message/device identity across generations. Preserve historical rows.
-- Serialize inserts so old publishers cannot recreate an accepted message after migration.
create function private.push_delivery_identity() returns trigger language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.message_id::text||':'||new.device_id,0));
 if exists(select 1 from private.push_deliveries where message_id=new.message_id and device_id=new.device_id) then return null;end if;
 select transport into new.transport from private.push_devices where id=new.device_id;
 return new;
end $$;
create trigger push_delivery_identity before insert on private.push_deliveries for each row execute function private.push_delivery_identity();

alter function public.bloom_push_device(text,uuid,text,text,jsonb) rename to bloom_push_device_before_native;
revoke all on function public.bloom_push_device_before_native(text,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
create function public.bloom_push_device(p_device text,p_user uuid,p_session text,p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb;begin
 if p_action in ('challenge','verify') and exists(select 1 from private.push_devices where id=p_device and transport='native') then raise sqlstate 'PT403' using message='FORBIDDEN';end if;
 r:=public.bloom_push_device_before_native(p_device,p_user,p_session,p_action,p_input);
 return r||coalesce((select jsonb_build_object('transport',transport,'registered',verified) from private.push_devices where id=p_device),'{}');
end $$;

create function public.bloom_push_enrollment(p_device text,p_user uuid,p_session text,p_action text,p_hash text,
 p_endpoint_hash text default null,p_fingerprint text default null,p_subscription text default null) returns void
language plpgsql security definer set search_path='' as $$
declare d private.push_devices;g uuid;changed boolean;begin
 perform public.bloom_push_device(p_device,p_user,p_session,'status');
 select * into d from private.push_devices where id=p_device for update;
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise sqlstate 'PT400' using message='VALIDATION_ERROR';end if;
 if p_action='start' then
  if d.enrollment_started>now()-interval '2 seconds' then raise sqlstate 'PT409' using message='CONFLICT';end if;
  update private.push_devices set enrollment_hash=p_hash,enrollment_user=p_user,enrollment_session=p_session,
   enrollment_generation=generation,enrollment_expires=now()+interval '5 minutes',enrollment_started=now() where id=p_device;
  return;
 end if;
 if p_action<>'complete' or d.enrollment_hash is distinct from p_hash or d.enrollment_user is distinct from p_user
  or d.enrollment_session is distinct from p_session or d.enrollment_generation is distinct from d.generation
  or d.enrollment_expires is null or d.enrollment_expires<=now() then raise sqlstate 'PT403' using message='FORBIDDEN';end if;
 if p_endpoint_hash is null or p_endpoint_hash !~ '^[a-f0-9]{64}$' or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
  or p_subscription is null or length(p_subscription)>8192 then raise sqlstate 'PT400' using message='VALIDATION_ERROR';end if;
 -- No endpoint transfer between browser capabilities, even if a caller knows its identifier.
 perform pg_advisory_xact_lock(hashtextextended('native-endpoint:'||p_endpoint_hash,0));
 if exists(select 1 from private.push_devices where native_endpoint_hash=p_endpoint_hash and id<>p_device) then raise sqlstate 'PT409' using message='CONFLICT';end if;
 changed:=d.transport<>'native' or d.native_fingerprint is distinct from p_fingerprint or not d.verified;
 if changed then
  -- Never race a provider call or replay an ambiguous attempted send through another transport.
  if exists(select 1 from private.push_deliveries where device_id=p_device and state='attempted' and lease_until>now()) then raise sqlstate 'PT409' using message='CONFLICT';end if;
  g:=gen_random_uuid();
  update private.push_deliveries set state='skipped',error_code='INELIGIBLE',lease=null,lease_until=null
   where device_id=p_device and state in ('pending','attempted') and attempts>0;
  update private.push_deliveries set generation=g,transport='native',display_token_hash=null
   where device_id=p_device and state='pending' and attempts=0;
  update private.push_devices set generation=g,onesignal_verified=case when transport='onesignal' then verified else onesignal_verified end,
   transport='native',verified=true,native_subscription=p_subscription,native_endpoint_hash=p_endpoint_hash,native_fingerprint=p_fingerprint,
   challenge_hash=null,challenge_expires=null where id=p_device;
 else
  -- Idempotent same-subscription retries do not invalidate queued messages/generations.
  update private.push_devices set native_subscription=p_subscription where id=p_device;
 end if;
 update private.push_devices set enrollment_hash=null,enrollment_expires=null where id=p_device;
 insert into private.push_device_accounts(device_id,user_id) values(p_device,p_user)
 on conflict(device_id,user_id) do update set enabled=true,linked_at=now() where not private.push_device_accounts.enabled;
end $$;

-- Only service dispatch can obtain encrypted endpoints. Device content reads never return them.
create or replace function public.bloom_push_delivery(p_id uuid,p_lease uuid default null,p_device text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare x record;content jsonb;begin
 select d.id,d.message_id,d.device_id,d.transport,d.generation,m.user_id,m.expires_at,m.kind,v.session_id,v.subscription_id,
  v.native_subscription,u.clerk_user_id into x
 from private.push_deliveries d join private.push_messages m on m.id=d.message_id
 join private.push_devices v on v.id=d.device_id and v.verified
 join private.push_device_accounts a on a.device_id=v.id and a.user_id=m.user_id and a.enabled and a.linked_at<=m.created_at
 join public.users u on u.id=m.user_id join private.push_preferences s on s.user_id=m.user_id
 where d.id=p_id and (
  (p_lease is not null and d.lease=p_lease and d.lease_until>now() and d.state='attempted'
   and d.generation=v.generation and d.transport=v.transport and s.push_enabled and m.created_at>=s.push_enabled_since)
  or (p_lease is null and p_device is not null and d.device_id=p_device and d.state in ('attempted','accepted')));
 if not found then return null;end if;
 content:=private.push_content(x.message_id,now());if content is null then return null;end if;
 content:=jsonb_set(content,'{body}',to_jsonb('['||(select initcap(role::text) from public.users where id=x.user_id)||'] '||(content->>'body')));
 return jsonb_build_object('deviceId',x.device_id,'transport',x.transport,'generation',x.generation,
  'subscription',case when p_lease is not null then x.subscription_id end,
  'nativeSubscription',case when p_lease is not null then x.native_subscription end,
  'session',x.session_id,'subject',x.clerk_user_id,'userId',x.user_id,'expiresAt',x.expires_at,'kind',x.kind,'content',content);
end $$;

create function public.bloom_push_display(p_id uuid,p_device text,p_token_hash text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from private.push_deliveries where id=p_id and device_id=p_device
  and (transport='onesignal' or (display_token_hash is not null and display_token_hash=p_token_hash))) then return null;end if;
 return public.bloom_push_delivery(p_id,null,p_device);
end $$;
create function public.bloom_push_display_token(p_id uuid,p_lease uuid,p_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_hash !~ '^[a-f0-9]{64}$' then return false;end if;
 update private.push_deliveries set display_token_hash=p_hash
 where id=p_id and lease=p_lease and state='attempted' and lease_until>now() and transport='native';
 return found;
end $$;

-- Rollback uses retained proven OneSignal registration; native-only devices fail closed.
create function public.bloom_push_rollback_device(p_device text) returns void
language plpgsql security definer set search_path='' as $$
declare d private.push_devices;g uuid;begin
 perform pg_advisory_xact_lock(hashtextextended(p_device,0));
 select * into d from private.push_devices where id=p_device for update;
 if d.transport='onesignal' then return;end if;
 if d.id is null or not d.onesignal_verified or d.subscription_id is null then raise sqlstate 'PT409' using message='CONFLICT';end if;
 if exists(select 1 from private.push_deliveries where device_id=p_device and state='attempted' and lease_until>now()) then raise sqlstate 'PT409' using message='CONFLICT';end if;
 g:=gen_random_uuid();
 update private.push_deliveries set state='skipped',error_code='INELIGIBLE',lease=null,lease_until=null where device_id=p_device and state in ('pending','attempted') and attempts>0;
 update private.push_deliveries set generation=g,transport='onesignal',display_token_hash=null where device_id=p_device and state='pending' and attempts=0;
 update private.push_devices set transport='onesignal',generation=g,verified=true,enrollment_hash=null,enrollment_expires=null where id=p_device;
end $$;

-- Enrollment/account mutations lock device before delivery. Finish follows that order too.
create or replace function public.bloom_push_finish(p_id uuid,p_lease uuid,p_state text,p_provider uuid default null,p_error text default null,p_invalid boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare d private.push_deliveries;device text;begin
 if p_state not in ('pending','accepted','failed','skipped') or (p_error is not null and p_error not in ('TRANSIENT','PROVIDER_REJECTED','SUBSCRIPTION_EXPIRED','SESSION_ENDED','INELIGIBLE','TEST_ONLY','EXPIRED')) then raise sqlstate 'PT400' using message='VALIDATION_ERROR';end if;
 select device_id into device from private.push_deliveries where id=p_id;
 if device is null then return;end if;
 perform pg_advisory_xact_lock(hashtextextended(device,0));
 perform 1 from private.push_devices where id=device for update;
 select * into d from private.push_deliveries where id=p_id and lease=p_lease and state='attempted' for update;
 if not found then return;end if;
 update private.push_deliveries set state=case when p_state='pending' and attempts>=4 then 'failed' else p_state end,
  provider_id=p_provider,error_code=p_error,lease_until=null,next_attempt=now()+make_interval(secs=>least(240,30*(2^attempts)::integer)),updated_at=now() where id=p_id;
 if p_invalid then update private.push_devices set verified=false where id=d.device_id and generation=d.generation;end if;
end $$;

revoke all on function private.push_delivery_identity(),public.bloom_push_device(text,uuid,text,text,jsonb),
 public.bloom_push_enrollment(text,uuid,text,text,text,text,text,text),public.bloom_push_delivery(uuid,uuid,text),
 public.bloom_push_display(uuid,text,text),public.bloom_push_display_token(uuid,uuid,text),public.bloom_push_rollback_device(text)
 from public,anon,authenticated;
grant execute on function public.bloom_push_device(text,uuid,text,text,jsonb),public.bloom_push_enrollment(text,uuid,text,text,text,text,text,text),
 public.bloom_push_delivery(uuid,uuid,text),public.bloom_push_display(uuid,text,text),public.bloom_push_display_token(uuid,uuid,text),public.bloom_push_rollback_device(text) to service_role;
commit;
