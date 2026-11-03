begin;

do $$
declare
 city uuid;
 owner_id uuid;
 completing_cleaner uuid;
 visible_cleaner uuid;
 hidden_cleaner uuid;
 property_id uuid;
 job_id uuid;
 photo_id uuid;
 photos jsonb;
 blocked boolean:=false;
begin
 select id into city from public.cities where active limit 1;
 if city is null then raise exception 'Fixture requires an active city';end if;

 insert into public.users(clerk_user_id,role,onboarding_completed_at)
 values('completed-photo-owner','owner',now()) returning id into owner_id;
 insert into public.users(clerk_user_id,role,onboarding_completed_at)
 values('completed-photo-completer','cleaner',now()) returning id into completing_cleaner;
 insert into public.users(clerk_user_id,role,onboarding_completed_at,bloom_network_enabled,approved_city_id,initial_city_selected_at)
 values('completed-photo-viewer','cleaner',now(),true,city,now()) returning id into visible_cleaner;
 insert into public.users(clerk_user_id,role,onboarding_completed_at,bloom_network_enabled)
 values('completed-photo-hidden','cleaner',now(),false) returning id into hidden_cleaner;

 insert into public.properties(city_id,name,address)
 values(city,'Completed photo fixture','Local only') returning id into property_id;
 insert into public.property_owners values(property_id,owner_id);
 insert into public.jobs(property_id,checkout_date,start_at,end_at,timezone_snapshot,solo_rate_cents_snapshot)
 values(property_id,current_date,(current_date+time '11:00') at time zone 'America/Detroit',(current_date+time '15:00') at time zone 'America/Detroit','America/Detroit',7500)
 returning id into job_id;
 update public.jobs set status='completed',completed_at=now(),completed_by=completing_cleaner where id=job_id;
 insert into public.job_photos(job_id,uploader_id,category,object_path,bytes,mime,state)
 values(job_id,completing_cleaner,'bedrooms',job_id::text||'/completed-photo-fixture',100,'image/jpeg','ready')
 returning id into photo_id;

 perform set_config('request.jwt.claims','{"sub":"completed-photo-viewer"}',true);
 photos:=public.bloom_photos(job_id);
 if photos->0->>'id'<>photo_id::text then
  raise exception 'Eligible cleaner cannot read completed photos: %',photos;
 end if;

 perform set_config('request.jwt.claims','{"sub":"completed-photo-hidden"}',true);
 begin
  perform public.bloom_photos(job_id);
 exception when others then
  blocked:=sqlerrm='NOT_FOUND';
 end;
 if not blocked then raise exception 'Ineligible cleaner read completed photos';end if;
end $$;

rollback;
