-- Local acceptance checks. All fixtures and writes are rolled back.
\set ON_ERROR_STOP on
begin;
do $$
declare p uuid;o uuid;u uuid;s text:=gen_random_uuid()::text;
begin
 insert into public.users(clerk_user_id,role,onboarding_completed_at) values('cover-owner-'||s,'owner',now()) returning id into o;
 perform set_config('bloom.test.owner','cover-owner-'||s,true);
 insert into public.users(clerk_user_id,role,onboarding_completed_at) values('cover-admin-'||s,'admin',now());
 perform set_config('bloom.test.admin','cover-admin-'||s,true);
 insert into public.users(clerk_user_id,role,onboarding_completed_at) values('cover-outsider-'||s,'owner',now());
 perform set_config('bloom.test.outsider','cover-outsider-'||s,true);
 insert into public.users(clerk_user_id,role,onboarding_completed_at,approved_city_id,initial_city_selected_at) values('cover-cleaner-'||s,'cleaner',now(),'00000000-0000-4000-8000-000000000001',now()) returning id into u;
 perform set_config('bloom.test.cleaner','cover-cleaner-'||s,true);
 insert into public.properties(city_id,name,address) values('00000000-0000-4000-8000-000000000001','Airbnb cover test','Synthetic fixture') returning id into p;
 insert into public.property_owners values(p,o);
 insert into public.property_thumbnails values(p,'data:image/jpeg;base64,AAAA');
 perform set_config('bloom.test.property',p::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bloom.test.owner'),'role','authenticated')::text,true);
do $$
declare p uuid:=current_setting('bloom.test.property')::uuid;r jsonb;image text:='https://a0.muscache.com/im/pictures/hosting/Hosting-1568588871312234223/original/d6cbebb5-dbdd-4fb8-8d1f-5e6594ee591f.jpeg?im_w=720';
begin
 r:=public.bloom_property_airbnb(p,true,'https://www.airbnb.com/rooms/1568588871312234223',image,'extracted',0,'owner-save');
 assert r->>'image'=image and (r->>'revision')::int=1 and (r->>'canEdit')::boolean;
 -- Lost response can be replayed even if upstream extraction now fails.
 assert public.bloom_property_airbnb(p,true,'https://www.airbnb.com/rooms/1568588871312234223',null,'unavailable',0,'owner-save')=r;
 assert public.bloom_property_airbnb(p)->>'image'=image;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bloom.test.admin'),'role','authenticated')::text,true);
do $$
declare p uuid:=current_setting('bloom.test.property')::uuid;r jsonb;
begin
 assert public.bloom_property_airbnb(p)->>'listingUrl'='https://www.airbnb.com/rooms/1568588871312234223';
 r:=public.bloom_property_airbnb(p,true,'https://www.airbnb.com/rooms/42',null,'unavailable',1,'admin-replace');
 assert r->>'image' is null and r->>'status'='unavailable' and (r->>'revision')::int=2;
 begin perform public.bloom_property_airbnb(p,true,null,null,'none',1,'stale-edit');raise exception 'STALE_WRITE_ALLOWED';exception when raise_exception then if sqlerrm<>'CONFLICT' then raise;end if;end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bloom.test.owner'),'role','authenticated')::text,true);
do $$
declare p uuid:=current_setting('bloom.test.property')::uuid;r jsonb;
begin
 -- Independent read simulates refresh; Admin replacement is shared with Owner.
 r:=public.bloom_property_airbnb(p);assert r->>'listingUrl'='https://www.airbnb.com/rooms/42' and r->>'image' is null;
 r:=public.bloom_property_airbnb(p,true,'https://www.airbnb.com/rooms/42','https://a0.muscache.com/pictures/manual.jpg?im_w=720','manual',2,'manual-fallback');
 assert r->>'status'='manual';
 r:=public.bloom_property_airbnb(p,true,null,null,'none',3,'clear-listing');
 assert r->>'listingUrl' is null and r->>'image' is null; -- No resurrection of legacy thumbnail.
 begin perform public.bloom_property_airbnb(p,true,'https://evil.test/rooms/42',null,'unavailable',4,'invalid-url');raise exception 'BAD_URL_ALLOWED';exception when raise_exception then if sqlerrm<>'VALIDATION_ERROR' then raise;end if;end;
 begin execute format('update public.properties set airbnb_cover_url=null where id=%L',p);raise exception 'DIRECT_WRITE_ALLOWED';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bloom.test.outsider'),'role','authenticated')::text,true);
do $$
declare p uuid:=current_setting('bloom.test.property')::uuid;
begin
 begin perform public.bloom_property_airbnb(p);raise exception 'OUTSIDER_READ_ALLOWED';exception when raise_exception then if sqlerrm<>'NOT_FOUND' then raise;end if;end;
 begin perform public.bloom_property_airbnb(p,true,null,null,'none',4,'outsider');raise exception 'OUTSIDER_WRITE_ALLOWED';exception when raise_exception then if sqlerrm<>'NOT_FOUND' then raise;end if;end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bloom.test.cleaner'),'role','authenticated')::text,true);
do $$
begin
 begin perform public.bloom_property_airbnb(current_setting('bloom.test.property')::uuid,true,null,null,'none',4,'cleaner');raise exception 'CLEANER_WRITE_ALLOWED';exception when raise_exception then if sqlerrm<>'NOT_FOUND' then raise;end if;end;
end $$;
set local role anon;
do $$begin
 begin perform public.bloom_property_airbnb(current_setting('bloom.test.property')::uuid);raise exception 'ANON_READ_ALLOWED';exception when insufficient_privilege then null;end;
end $$;
rollback;
\echo 'PASS: shared Owner/Admin covers, refresh, fallback, replacement, replay, conflicts and authorization'
