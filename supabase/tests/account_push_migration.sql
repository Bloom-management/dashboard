do $$
declare s private.push_preferences;begin
 select * into s from private.push_preferences where user_id='00000000-0000-4000-8000-000000000078';
 if not s.push_enabled or not s.initialized or s.new_jobs or not s.reminders or s.completions or s.starts or s.low_supplies or not s.maintenance then
  raise exception 'Migration changed saved choices or failed to preserve enabled consent';
 end if;
 perform public.bloom_push_device(repeat('c',64),s.user_id,'fixture','preferences','{"pushEnabled":false}');
 perform public.bloom_push_device(repeat('c',64),s.user_id,'fixture','preferences','{"pushEnabled":true}');
 select * into s from private.push_preferences where user_id=s.user_id;
 if s.new_jobs or s.completions or s.starts or s.low_supplies then raise exception 'Re-enable overwrote legacy choices';end if;
end $$;
delete from private.push_devices where id=repeat('c',64);
delete from private.push_preferences where user_id='00000000-0000-4000-8000-000000000078';
delete from public.users where id='00000000-0000-4000-8000-000000000078';
