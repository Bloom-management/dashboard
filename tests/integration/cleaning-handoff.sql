-- LOCAL DATABASE ONLY. Uses an existing open, configured two-cleaner fixture.
-- All writes (including queued notifications) are rolled back; no push sender runs.
begin;
create temporary table handoff_test_fixture as select j.id as job_id from public.jobs j where j.status='open' and not j.review_required and j.cleaning_config is not null and (select count(*) from public.assignments where job_id=j.id and ended_at is null)=2 limit 1;
do $$begin if not exists(select 1 from handoff_test_fixture) then raise exception 'Create an open two-cleaner local fixture first';end if;end $$;
update public.jobs set started_at=now(),checkout_date=current_date-1,start_at=((current_date-1+time '11:00') at time zone timezone_snapshot),end_at=((current_date-1+time '15:00') at time zone timezone_snapshot) where id=(select job_id from handoff_test_fixture);
select set_config('request.jwt.claims',jsonb_build_object('sub',u.clerk_user_id)::text,true) from public.assignments a join public.users u on u.id=a.cleaner_id where a.job_id=(select job_id from handoff_test_fixture) and a.ended_at is null order by a.id limit 1;
do $$declare r jsonb;d jsonb:='{"version":1,"answers":{},"maintenance":{},"notes":"Kitchen is done","reviewed":[],"guestReview":{"rating":4.5,"comment":"Tidy"}}';begin
 d:=jsonb_set(d,'{version}',(select cleaning_config->'version' from public.jobs where id=(select job_id from handoff_test_fixture)));
 r:=public.bloom_cleaning_handoff((select job_id from handoff_test_fixture),d,0,'handoff-test');
 if r->>'revision'<>'1' or not (r->'missing' ? ('Photo: '||(select cleaning_config->'rooms'->0->>'label' from public.jobs where id=(select job_id from handoff_test_fixture)))) then raise exception 'bad response %',r;end if;
 if public.bloom_cleaning_handoff((select job_id from handoff_test_fixture),d,0,'handoff-test')<>r then raise exception 'not idempotent';end if;
 if (select count(*) from private.cleaning_handoff_notices where job_id=(select job_id from handoff_test_fixture))<>1 then raise exception 'duplicate notice';end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',u.clerk_user_id)::text,true) from public.assignments a join public.users u on u.id=a.cleaner_id where a.job_id=(select job_id from handoff_test_fixture) and a.ended_at is null order by a.id offset 1 limit 1;
do $$declare r jsonb;begin
 r:=public.bloom_cleaning_handoff((select job_id from handoff_test_fixture));
 if r->'draft'->>'notes'<>'Kitchen is done' then raise exception 'not shared';end if;
 if not exists(select 1 from private.inbox_items() where id like 'handoff:%') then raise exception 'notification missing';end if;
 if not exists(select 1 from private.push_messages where kind='handoff' and private.push_content(id,now()) is not null) then raise exception 'push missing';end if;
 begin perform public.bloom_cleaning_handoff((select job_id from handoff_test_fixture),r->'draft',0,'stale');raise exception 'stale accepted';exception when others then if sqlerrm<>'CONFLICT' then raise;end if;end;
 begin perform private.complete_cleaning((select job_id from handoff_test_fixture),'{}','stale-complete');raise exception 'stale completion accepted';exception when others then if sqlerrm<>'CONFLICT' then raise;end if;end;
 r:=public.bloom_cleaning_handoff((select job_id from handoff_test_fixture),jsonb_set(r->'draft','{notes}','"Living room also done"'),1,'return-handoff');
 if r->>'revision'<>'2' then raise exception 'second cleaner cannot handoff';end if;
end $$;
insert into public.job_photos(job_id,uploader_id,category,room_id,object_path,state,bytes,mime)
select j.id,(select cleaner_id from public.assignments where job_id=j.id and ended_at is null limit 1),room->>'type',(room->>'id')::uuid,'handoff-test/'||gen_random_uuid(),'ready',1,'image/jpeg'
from public.jobs j cross join lateral jsonb_array_elements(j.cleaning_config->'rooms') room where j.id=(select job_id from handoff_test_fixture);
do $$declare person record;r jsonb;payload jsonb;begin
 select jsonb_build_object('configVersion',cleaning_config->'version','answers',coalesce((select jsonb_agg(jsonb_build_object('supplyId',x->>'id','level','full')) from jsonb_array_elements(cleaning_config->'supplies') x),'[]'::jsonb),'notes','Shared work complete','maintenance',(select jsonb_agg(jsonb_build_object('category',c,'status','not_applicable','notes','')) from unnest(array['painting','fridge','electricity','wifi','tv','garage','climate','water']) c),'guestReview',jsonb_build_object('rating',4.5,'comment','Tidy'),'handoffRevision',2) into payload from public.jobs where id=(select job_id from handoff_test_fixture);
 for person in select u.clerk_user_id from public.assignments a join public.users u on u.id=a.cleaner_id where a.job_id=(select job_id from handoff_test_fixture) and a.ended_at is null loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',person.clerk_user_id)::text,true);
  begin
   r:=public.bloom_job_action((select job_id from handoff_test_fixture),'complete','complete-test-'||person.clerk_user_id,null,payload);
   if r->'job'->>'status'<>'completed' then raise exception 'Completion failed %',r;end if;
   if public.bloom_job_action((select job_id from handoff_test_fixture),'complete','complete-test-'||person.clerk_user_id,null,payload)<>r then raise exception 'Completion retry differs';end if;
   raise exception 'TEST_ROLLBACK_COMPLETION';
  exception when others then if sqlerrm<>'TEST_ROLLBACK_COMPLETION' then raise;end if;end;
 end loop;
end $$;
select set_config('request.jwt.claims','{"sub":"not-an-assignee"}',true);
do $$begin
 begin perform public.bloom_cleaning_handoff((select job_id from handoff_test_fixture));raise exception 'unauthorized read';exception when others then if sqlerrm not in ('UNAUTHENTICATED','NOT_FOUND') then raise;end if;end;
end $$;
rollback;
