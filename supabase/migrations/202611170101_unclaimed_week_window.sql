begin;
-- Scheduled unclaimed reminders cover every checkout 1-7 property-local days out (was +1 and +3).
-- Each cleaner still gets at most one combined reminder per day; the per-job/day ledger is unchanged.
do $$declare definition text;changed text;begin
 definition:=pg_get_functiondef('public.bloom_push_tick(timestamptz)'::regprocedure);
 changed:=replace(definition,'job.checkout_date in(day+3,day+1)','job.checkout_date between day+1 and day+7');
 if changed=definition then raise exception 'bloom_push_tick unclaimed window not found';end if;
 execute changed;
end $$;
revoke all on function public.bloom_push_tick(timestamptz) from public,anon,authenticated;
grant execute on function public.bloom_push_tick(timestamptz) to service_role;

-- Manual runs default to the same 1-7 day window.
alter function public.bloom_push_notify_unclaimed(integer[],boolean) rename to bloom_push_notify_unclaimed_window;
revoke all on function public.bloom_push_notify_unclaimed_window(integer[],boolean) from public,anon,authenticated,service_role;
create function public.bloom_push_notify_unclaimed(p_days integer[] default '{1,2,3,4,5,6,7}',p_resend boolean default false) returns integer language sql security definer set search_path='' as $$
 select public.bloom_push_notify_unclaimed_window(p_days,p_resend);
$$;
revoke all on function public.bloom_push_notify_unclaimed(integer[],boolean) from public,anon,authenticated;
grant execute on function public.bloom_push_notify_unclaimed(integer[],boolean) to service_role;

-- Service-only operator view: why an account does or does not receive push.
create function public.bloom_push_recipient_status() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('userId',u.id,'clerkUserId',u.clerk_user_id,'role',u.role,'name',u.display_name,
  'network',u.bloom_network_enabled,'poolApproved',u.bloom_pool_approved,'cityId',u.approved_city_id,
  'pushEnabled',coalesce(s.push_enabled,false),'newJobs',coalesce(s.new_jobs,false),'unclaimed',private.notification_preference(u.id,'unclaimed'),
  'linkedDevices',(select count(*) from private.push_device_accounts a join private.push_devices d on d.id=a.device_id and d.verified where a.user_id=u.id and a.enabled),
  'lastDelivery',(select max(x.updated_at) from private.push_deliveries x join private.push_messages m on m.id=x.message_id where m.user_id=u.id and x.state='accepted'))
  order by u.role,u.display_name),'[]') from public.users u left join private.push_preferences s on s.user_id=u.id;
$$;
revoke all on function public.bloom_push_recipient_status() from public,anon,authenticated;
grant execute on function public.bloom_push_recipient_status() to service_role;
commit;
