\set ON_ERROR_STOP on
begin;
do $$
declare own public.users; other_user public.users; cleaner public.users; admin_user public.users;
 prop uuid; job uuid; room uuid:=gen_random_uuid(); result jsonb; notice text; count_events integer;
begin
 insert into public.users(clerk_user_id,role,display_name,onboarding_completed_at) values('activity-owner-'||gen_random_uuid(),'owner','Activity owner',now()) returning * into own;
 insert into public.users(clerk_user_id,role,display_name,onboarding_completed_at) values('activity-other-'||gen_random_uuid(),'owner','Other owner',now()) returning * into other_user;
 insert into public.users(clerk_user_id,role,display_name,onboarding_completed_at) values('activity-cleaner-'||gen_random_uuid(),'cleaner','Activity cleaner',now()) returning * into cleaner;
 insert into public.users(clerk_user_id,role,display_name,onboarding_completed_at) values('activity-admin-'||gen_random_uuid(),'admin','Activity admin',now()) returning * into admin_user;
 insert into public.properties(city_id,name,address,cleaning_config) values('00000000-0000-4000-8000-000000000001','Activity fixture','Synthetic address',jsonb_build_object('rooms',jsonb_build_array(jsonb_build_object('id',room,'type','bedrooms','label','Upstairs bedroom')))) returning id into prop;
 insert into public.property_owners values(prop,own.id);
 insert into public.jobs(property_id,checkout_date,start_at,end_at,timezone_snapshot,solo_rate_cents_snapshot) values(prop,current_date,(current_date+time '11:00') at time zone 'America/Detroit',(current_date+time '15:00') at time zone 'America/Detroit','America/Detroit',7500) returning id into job;

 update public.properties set cleaning_config=jsonb_build_object('supplies',jsonb_build_array(jsonb_build_object('id',room,'name','Body soap'))) where id=prop;
 update public.jobs set status='completed',completed_at=now(),completed_by=cleaner.id where id=job;
 insert into public.job_supply_reports values(job,room,'Body soap','low',cleaner.id,now());
 insert into public.job_maintenance_reports values(job,'wifi','attention','Router needs checking',cleaner.id,now());
 for result in select to_jsonb(u) from public.users u where u.id in (own.id,admin_user.id) loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',result->>'clerk_user_id')::text,true);
  select item into result from jsonb_array_elements(public.bloom_owner_listings()->'items') item where item->>'id'=prop::text;
  if result#>>'{supplies,0,level}' is distinct from 'low' then raise exception 'Saved supply level missing';end if;
  if result#>>'{maintenance,0,status}' is distinct from 'attention' then raise exception 'Saved maintenance missing';end if;
 end loop;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',other_user.clerk_user_id)::text,true);
 if exists(select 1 from jsonb_array_elements(public.bloom_owner_listings()->'items') item where item->>'id'=prop::text) then raise exception 'Cross owner listing exposed';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',cleaner.clerk_user_id)::text,true);
 begin perform public.bloom_owner_listings();raise exception 'Cleaner accessed owner listings';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 raise notice 'Admin and owner saved supplies/maintenance projection, cross-owner isolation and cleaner denial passed.';
end $$;
rollback;
