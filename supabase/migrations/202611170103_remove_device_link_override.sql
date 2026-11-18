begin;
-- The operator device-link override was used on an account owned by a different person.
-- Remove the override and provide its exact reversal; devices must enroll from their own browser.
create function public.bloom_push_unlink_account_devices(p_source uuid,p_target uuid) returns integer language plpgsql security definer set search_path='' as $$
declare n integer;begin
 if p_source is null or p_target is null or p_source=p_target then raise sqlstate 'PT400' using message='VALIDATION_ERROR';end if;
 delete from private.push_device_accounts t using private.push_device_accounts s
 where s.user_id=p_source and t.device_id=s.device_id and t.user_id=p_target;
 get diagnostics n=row_count;return n;
end $$;
revoke all on function public.bloom_push_unlink_account_devices(uuid,uuid) from public,anon,authenticated;
grant execute on function public.bloom_push_unlink_account_devices(uuid,uuid) to service_role;
drop function public.bloom_push_link_account_devices(uuid,uuid);
commit;
