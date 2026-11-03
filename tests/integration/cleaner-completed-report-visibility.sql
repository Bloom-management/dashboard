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
 report jsonb;
 blocked boolean:=false;
begin
 select id into city from public.cities where active limit 1;
 if city is null then raise exception 'Fixture requires an active city';end if;

 insert into public.users(clerk_user_id,role,onboarding_completed_at)
 values('completed-report-owner','owner',now()) returning id into owner_id;
 insert into public.users(clerk_user_id,role,onboarding_completed_at)
 values('completed-report-completer','cleaner',now()) returning id into completing_cleaner;
 insert into public.users(clerk_user_id,role,onboarding_completed_at,bloom_network_enabled,approved_city_id,initial_city_selected_at)
 values('completed-report-viewer','cleaner',now(),true,city,now()) returning id into visible_cleaner;
 insert into public.users(clerk_user_id,role,onboarding_completed_at,bloom_network_enabled)
 values('completed-report-hidden','cleaner',now(),false) returning id into hidden_cleaner;

 insert into public.properties(city_id,name,address)
 values(city,'Completed report fixture','Local only') returning id into property_id;
 insert into public.property_owners values(property_id,owner_id);
 insert into public.jobs(property_id,checkout_date,start_at,end_at,timezone_snapshot,solo_rate_cents_snapshot)
 values(property_id,current_date,(current_date+time '11:00') at time zone 'America/Detroit',(current_date+time '15:00') at time zone 'America/Detroit','America/Detroit',7500)
 returning id into job_id;
 update public.jobs
 set status='completed',completed_at=now(),completed_by=completing_cleaner,
     completion_receipt=jsonb_build_object('rooms','[]'::jsonb,'notes','Done')
 where id=job_id;

 perform set_config('request.jwt.claims','{"sub":"completed-report-viewer"}',true);
 report:=public.bloom_cleaning_report(job_id);
 if report->>'jobId'<>job_id::text or report->>'propertyName'<>'Completed report fixture' then
  raise exception 'Eligible cleaner cannot read completed report: %',report;
 end if;

 perform set_config('request.jwt.claims','{"sub":"completed-report-hidden"}',true);
 begin
  perform public.bloom_cleaning_report(job_id);
 exception when others then
  blocked:=sqlerrm='NOT_FOUND';
 end;
 if not blocked then raise exception 'Ineligible cleaner read completed report';end if;
end $$;

rollback;
