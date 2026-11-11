-- Synthetic legacy consent, applied immediately before the account preference migration.
insert into public.users(id,clerk_user_id,role) values('00000000-0000-4000-8000-000000000078','push_migration_fixture','cleaner');
insert into private.push_preferences(user_id,new_jobs,reminders,completions,starts,low_supplies,maintenance)
 values('00000000-0000-4000-8000-000000000078',false,true,false,false,false,true);
insert into private.push_devices(id,user_id,session_id,subscription_id,verified)
 values(repeat('c',64),'00000000-0000-4000-8000-000000000078','fixture',gen_random_uuid(),true);
insert into private.push_device_accounts(device_id,user_id) values(repeat('c',64),'00000000-0000-4000-8000-000000000078');
