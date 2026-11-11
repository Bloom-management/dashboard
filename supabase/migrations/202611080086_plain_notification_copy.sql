begin;
-- The account role remains part of authorization and routing metadata. It is not
-- user-facing notification copy; each account's content already identifies the
-- relevant property, job and action.
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
 return jsonb_build_object('deviceId',x.device_id,'transport',x.transport,'generation',x.generation,
  'subscription',case when p_lease is not null then x.subscription_id end,
  'nativeSubscription',case when p_lease is not null then x.native_subscription end,
  'session',x.session_id,'subject',x.clerk_user_id,'userId',x.user_id,'expiresAt',x.expires_at,'kind',x.kind,'content',content);
end $$;
commit;
