\set ON_ERROR_STOP on
-- Run only against the local development database. These are explicitly labeled
-- synthetic records; no real cleaner earnings are changed. Accounting history stays.
begin;
do $$
declare cleaner uuid;partner uuid;admin_id uuid;city uuid;unit_id uuid;j uuid;i integer;begin
 select id into admin_id from public.users where role='admin' and onboarding_completed_at is not null order by created_at limit 1;
 select id into city from public.cities where active order by name limit 1;
 if admin_id is null then raise exception 'Local admin required';end if;
 insert into public.users(clerk_user_id,role,display_name,approved_city_id,onboarding_completed_at) values('local-payout-browser-'||gen_random_uuid(),'cleaner','LOCAL TEST Payouts browser',city,now()) returning id into cleaner;
 insert into public.users(clerk_user_id,role,display_name,approved_city_id,onboarding_completed_at) values('local-payout-partner-'||gen_random_uuid(),'cleaner','LOCAL TEST Payouts partner',city,now()) returning id into partner;
 insert into public.properties(city_id,name,timezone,address,is_bloom_owned,solo_rate_cents) values(city,'LOCAL TEST Payouts unit','America/Detroit','Development fixture only',true,9000) returning id into unit_id;
 for i in 1..5 loop
 insert into public.jobs(property_id,checkout_date,start_at,end_at,timezone_snapshot,solo_rate_cents_snapshot,completion_receipt)
 values(unit_id,current_date-(10-i),(current_date-(10-i)+time '11:00') at time zone 'America/Detroit',(current_date-(10-i)+time '15:00') at time zone 'America/Detroit','America/Detroit',9000,jsonb_build_object('notes','LOCAL TEST completion comment for payout review')) returning id into j;
 insert into public.assignments(job_id,cleaner_id,slot,completed_pay_cents) values(j,cleaner,1,case when i=1 then 9000 when i=2 then 4100 when i=3 then 6300 else null end);
 if i=2 then insert into public.assignments(job_id,cleaner_id,slot,completed_pay_cents) values(j,partner,2,4900);end if;
 if i<>5 then update public.jobs set status='completed',completed_at=now(),completed_by=admin_id where id=j;end if;
 end loop;
 raise notice 'LOCAL TEST Payouts cleaner ID: %',cleaner;
end $$;
commit;
