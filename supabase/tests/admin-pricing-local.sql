\set ON_ERROR_STOP on
begin;
do $$
declare a public.users;o public.users;c uuid;p public.properties;j public.jobs;result jsonb;begin
 select * into a from public.users where role='admin' limit 1;
 select * into o from public.users where role='owner' and onboarding_completed_at is not null limit 1;
 if a.id is null or o.id is null then raise exception 'Missing local test actors';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a.clerk_user_id)::text,true);
 insert into public.properties(city_id,name,timezone,address,is_bloom_owned,solo_rate_cents) select id,'Pricing rollback test','America/Detroit','Test',true,7500 from public.cities limit 1 returning * into p;
 update public.properties set cleaner_pricing_set=false where id=p.id;
 insert into public.jobs(property_id,checkout_date,start_at,end_at,timezone_snapshot,solo_rate_cents_snapshot) values(p.id,'2026-10-01','2026-10-01 15:00Z','2026-10-01 19:00Z','America/Detroit',7500) returning * into j;
 if not public.bloom_admin_pricing() @> jsonb_build_array(jsonb_build_object('id',p.id)) then raise exception 'Notification missing';end if;
 perform public.bloom_admin_set_pricing(p.id,10000,'test-unit');
 perform public.bloom_admin_set_pricing(p.id,10000,'test-unit');
 if (select count(*) from private.cleaner_pricing_audit where property_id=p.id)<>1 then raise exception 'Duplicate audit';end if;
 if (select solo_rate_cents_snapshot from public.jobs where id=j.id)<>10000 then raise exception 'Unassigned job not updated';end if;
 if public.bloom_admin_pricing() @> jsonb_build_array(jsonb_build_object('id',p.id)) then raise exception 'Notification not resolved';end if;
 select * into j from public.jobs where id=j.id;
 perform public.bloom_admin_set_pricing(j.id,12000,'test-job',true,j.version,'Test override');
 perform public.bloom_admin_set_pricing(j.id,12000,'test-job',true,j.version,'Test override');
 begin perform public.bloom_admin_set_pricing(j.id,13000,'test-stale',true,j.version,'Stale');raise exception 'Stale version accepted';exception when raise_exception then if sqlerrm<>'CONFLICT' then raise;end if;end;
 perform public.bloom_admin_set_pricing(p.id,14000,'test-unit-later');
 if (select solo_rate_cents_snapshot from public.jobs where id=j.id)<>12000 then raise exception 'Override overwritten';end if;
 begin perform public.bloom_admin_set_pricing(p.id,101,'test-odd');raise exception 'Odd cents accepted';exception when raise_exception then if sqlerrm<>'VALIDATION_ERROR' then raise;end if;end;
 insert into public.users(clerk_user_id,role,approved_city_id,onboarding_completed_at) values('pricing-test-'||gen_random_uuid(),'cleaner',p.city_id,now()) returning id into c;
 insert into public.assignments(job_id,cleaner_id,slot) values(j.id,a.id,1),(j.id,c,2);
 update public.jobs set status='completed',completed_at=now(),completed_by=a.id where id=j.id;
 select * into j from public.jobs where id=j.id;
 begin perform public.bloom_admin_set_pricing(j.id,18000,'completed-override',true,j.version,'Test');raise exception 'Completed job changed';exception when raise_exception then if sqlerrm<>'INVALID_STATE' then raise;end if;end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',o.clerk_user_id)::text,true);
 begin perform public.bloom_admin_pricing();raise exception 'Owner read allowed';exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 begin perform public.bloom_admin_set_pricing(p.id,16000,'owner-denied');raise exception 'Owner write allowed';exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 if has_function_privilege('anon','public.bloom_admin_set_pricing(uuid,integer,text,boolean,integer,text)','EXECUTE') then raise exception 'Anonymous grant';end if;
 raise notice 'Pricing, notification resolution, retries, override preservation, stale versions and owner denials passed';
end $$;
rollback;
