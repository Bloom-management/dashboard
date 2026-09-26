\set ON_ERROR_STOP on
begin;
do $$
declare a public.users;other_admin public.users;c uuid;c2 uuid;o uuid;city uuid;p uuid;j uuid;solo uuid;shared uuid;repeat_earning uuid;missing uuid;unfinished uuid;adm_earning uuid;fixture_assignment uuid;result jsonb;detail jsonb;payload jsonb;pay uuid;i integer;before_count integer;bad jsonb;begin
 select * into a from public.users where role='admin' and onboarding_completed_at is not null limit 1;
 if a.id is null then raise exception 'Local test admin missing';end if;
 select id into city from public.cities where active limit 1;
 insert into public.users(clerk_user_id,role,display_name,approved_city_id,onboarding_completed_at) values('payout-rollback-'||gen_random_uuid(),'cleaner','LOCAL TEST Payouts rollback',city,now()) returning id into c;
 insert into public.users(clerk_user_id,role,display_name,approved_city_id,onboarding_completed_at) values('payout-rollback-partner-'||gen_random_uuid(),'cleaner','LOCAL TEST Payouts partner rollback',city,now()) returning id into c2;
 insert into public.users(clerk_user_id,role,display_name,onboarding_completed_at) values('payout-rollback-owner-'||gen_random_uuid(),'owner','LOCAL TEST Payouts owner denial',now()) returning id into o;
 insert into public.properties(city_id,name,timezone,address,is_bloom_owned,solo_rate_cents) values(city,'LOCAL TEST Payouts rollback unit','America/Detroit','Rollback fixture',true,10000) returning id into p;
 for i in 1..6 loop
 insert into public.jobs(property_id,checkout_date,start_at,end_at,timezone_snapshot,solo_rate_cents_snapshot,completion_receipt) values(p,current_date-i-20,(current_date-i-20+time '11:00') at time zone 'America/Detroit',(current_date-i-20+time '15:00') at time zone 'America/Detroit','America/Detroit',10000,jsonb_build_object('notes','LOCAL TEST dispute comment')) returning id into j;
 insert into public.assignments(job_id,cleaner_id,slot,completed_pay_cents) values(j,case when i=6 then a.id else c end,1,case i when 1 then 10000 when 2 then 4200 when 3 then 8700 when 6 then 10000 else null end) returning id into fixture_assignment;
 -- Assignment IDs are independent even for repeat cleanings of the same unit.
 if i=1 then solo:=fixture_assignment;elsif i=2 then shared:=fixture_assignment;elsif i=3 then repeat_earning:=fixture_assignment;elsif i=4 then missing:=fixture_assignment;elsif i=5 then unfinished:=fixture_assignment;else adm_earning:=fixture_assignment;end if;
 if i=2 then insert into public.assignments(job_id,cleaner_id,slot,completed_pay_cents) values(j,c2,2,5800);end if;
 if i<>5 then update public.jobs set status='completed',completed_at=now(),completed_by=a.id where id=j;end if;
 end loop;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a.clerk_user_id)::text,true);
 detail:=public.bloom_admin_payouts(c);
 if (detail->>'totalDueCents')::integer<>22900 or jsonb_array_length(detail->'cleanings')<>4 or (detail->>'reviewCount')::integer<>1 then raise exception 'Incorrect finalized completed earnings: %',detail;end if;
 if not exists(select 1 from jsonb_array_elements(detail->'cleanings') x where x->>'id'=shared::text and x->>'participation'='shared' and (x->>'originalEarningsCents')::integer=4200 and x->>'comments'='LOCAL TEST dispute comment') then raise exception 'Saved shared earnings/comment missing';end if;
 if not exists(select 1 from jsonb_array_elements(public.bloom_admin_payouts()->'people') x where x->>'id'=a.id::text) then raise exception 'Admin participant missing';end if;
 perform public.bloom_admin_set_pricing(p,20000,'payout-property-rate');
 if public.bloom_admin_payouts(c)<>detail then raise exception 'Historical earnings changed with rate';end if;
 begin update public.assignments set completed_pay_cents=20000 where id=solo;raise exception 'Finalized earnings edited';exception when raise_exception then if sqlerrm<>'INVALID_STATE' then raise;end if;end;
 payload:=jsonb_build_object('amountCents',3000,'method','Cash','paymentDate',current_date,'note','LOCAL TEST partial','allocations',jsonb_build_array(jsonb_build_object('cleaningId',solo,'amountCents',2000),jsonb_build_object('cleaningId',shared,'amountCents',1000)));
 result:=public.bloom_admin_payout_action(c,'payment',payload,'partial');pay:=(result->>'id')::uuid;
 if public.bloom_admin_payout_action(c,'payment',payload,'partial')<>result then raise exception 'Replay changed';end if;
 if (select count(*) from private.payout_payments where cleaner_id=c)<>1 then raise exception 'Duplicate payment';end if;
 if (public.bloom_admin_payouts(c)->>'totalDueCents')::integer<>19900 then raise exception 'Incorrect partial balance';end if;
 begin perform public.bloom_admin_payout_action(c,'payment',payload||'{"amountCents":9999}','partial');raise exception 'Changed replay accepted';exception when raise_exception then if sqlerrm<>'CONFLICT' then raise;end if;end;
 begin perform public.bloom_admin_payout_action(c,'payment',jsonb_build_object('amountCents',9000,'method','Cash','paymentDate',current_date,'allocations',jsonb_build_array(jsonb_build_object('cleaningId',solo,'amountCents',9000))),'overpaid');raise exception 'Overpayment accepted';exception when raise_exception then if sqlerrm<>'CONFLICT' then raise;end if;end;
 begin perform public.bloom_admin_payout_action(c,'payment',jsonb_build_object('amountCents',1,'method','Cash','paymentDate',current_date,'allocations',jsonb_build_array(jsonb_build_object('cleaningId',missing,'amountCents',1))),'missing');raise exception 'Missing earnings guessed';exception when raise_exception then if sqlerrm<>'REVIEW_REQUIRED' then raise;end if;end;
 begin perform public.bloom_admin_payout_action(c,'adjustment',jsonb_build_object('cleaningId',missing,'amountCents',100,'reason','Guess'),'missing-adjust');raise exception 'Missing earnings adjusted';exception when raise_exception then if sqlerrm<>'REVIEW_REQUIRED' then raise;end if;end;
 begin perform public.bloom_admin_payout_action(c,'payment',jsonb_build_object('amountCents',1,'method','Cash','paymentDate',current_date,'allocations',jsonb_build_array(jsonb_build_object('cleaningId',unfinished,'amountCents',1))),'unfinished');raise exception 'Unfinished paid';exception when raise_exception then if sqlerrm<>'NOT_FOUND' then raise;end if;end;
 perform public.bloom_admin_payout_action(c,'adjustment',jsonb_build_object('cleaningId',solo,'amountCents',500,'reason','LOCAL TEST agreed extra work'),'adjustment');
 perform public.bloom_admin_payout_action(c,'adjustment',jsonb_build_object('cleaningId',solo,'amountCents',500,'reason','LOCAL TEST agreed extra work'),'adjustment');
 if (select count(*) from private.payout_adjustments where assignment_id=solo)<>1 or (select completed_pay_cents from public.assignments where id=solo)<>10000 then raise exception 'Adjustment rewrote original or duplicated';end if;
 begin perform public.bloom_admin_payout_action(c,'adjustment',jsonb_build_object('cleaningId',solo,'amountCents',-9000,'reason','LOCAL TEST too much'),'negative');raise exception 'Negative remaining allowed';exception when raise_exception then if sqlerrm<>'CONFLICT' then raise;end if;end;
 perform public.bloom_admin_payout_action(c,'preference','{"method":"Venmo"}','pref1');
 perform public.bloom_admin_payout_action(c,'preference','{"method":"Zelle"}','pref2');
 if (select method from private.payout_payments where id=pay)<>'Cash' then raise exception 'Historical actual method overwritten';end if;
 perform public.bloom_admin_payout_action(c,'void',jsonb_build_object('paymentId',pay,'reason','LOCAL TEST mistaken entry'),'void');
 perform public.bloom_admin_payout_action(c,'void',jsonb_build_object('paymentId',pay,'reason','LOCAL TEST mistaken entry'),'void');
 if (public.bloom_admin_payouts(c)->>'totalDueCents')::integer<>23400 or (select count(*) from private.payout_voids where payment_id=pay)<>1 then raise exception 'Void failed/repeated';end if;
 if (public.bloom_admin_payouts(c)->'payments'->0->>'voidReason')<>'LOCAL TEST mistaken entry' then raise exception 'Void audit absent';end if;
 perform public.bloom_admin_payout_action(c,'payment',jsonb_build_object('amountCents',10500,'method','Bank transfer','paymentDate',current_date,'allocations',jsonb_build_array(jsonb_build_object('cleaningId',solo,'amountCents',10500))),'full');
 if (select remaining_cents from private.payout_balances where id=solo)<>0 then raise exception 'Full payment failed';end if;

 -- Invalid allocation shapes, totals and non-string notes are rejected before writes.
 for bad in select value from jsonb_array_elements(jsonb_build_array(
 jsonb_build_object('amountCents',2,'method','Cash','paymentDate',current_date,'allocations',jsonb_build_array(jsonb_build_object('cleaningId',shared,'amountCents',1))),
 jsonb_build_object('amountCents',2,'method','Cash','paymentDate',current_date,'allocations',jsonb_build_array(jsonb_build_object('cleaningId',shared,'amountCents',1),jsonb_build_object('cleaningId',shared,'amountCents',1))),
 jsonb_build_object('amountCents',1,'method','Cash','paymentDate',current_date,'note',123,'allocations',jsonb_build_array(jsonb_build_object('cleaningId',shared,'amountCents',1))),
 jsonb_build_object('amountCents',99999999999999,'method','Cash','paymentDate',current_date,'allocations','[]'::jsonb),
 jsonb_build_object('amountCents',1,'method','Cash','paymentDate',current_date+1,'allocations',jsonb_build_array(jsonb_build_object('cleaningId',shared,'amountCents',1)))
 )) loop
 begin perform public.bloom_admin_payout_action(c,'payment',bad,'invalid-'||gen_random_uuid());raise exception 'Invalid payment accepted';exception when raise_exception then if sqlerrm<>'VALIDATION_ERROR' then raise;end if;end;
 end loop;
 begin perform public.bloom_admin_payout_action(c,'adjustment',jsonb_build_object('cleaningId',shared,'amountCents',1,'reason',' '),'empty-reason');raise exception 'Reason not required';exception when raise_exception then if sqlerrm<>'VALIDATION_ERROR' then raise;end if;end;
 begin perform public.bloom_admin_payout_action(c,'void',jsonb_build_object('paymentId',pay,'reason',''),'empty-void');raise exception 'Void reason not required';exception when raise_exception then if sqlerrm<>'VALIDATION_ERROR' then raise;end if;end;
 begin perform public.bloom_admin_payout_action(c2,'payment',jsonb_build_object('amountCents',1,'method','Cash','paymentDate',current_date,'allocations',jsonb_build_array(jsonb_build_object('cleaningId',shared,'amountCents',1))),'wrong-payee');raise exception 'Other payee allocation allowed';exception when raise_exception then if sqlerrm<>'NOT_FOUND' then raise;end if;end;
 perform public.bloom_admin_payout_action(c,'adjustment',jsonb_build_object('cleaningId',shared,'amountCents',-200,'reason','LOCAL TEST agreed correction'),'negative-valid');
 if (select completed_pay_cents from public.assignments where id=shared)<>4200 or (select remaining_cents from private.payout_balances where id=shared)<>4000 then raise exception 'Negative adjustment failed';end if;
 -- Role changes never remove historical earnings from the directory.
 update public.users set role='owner' where id=c;
 if not exists(select 1 from jsonb_array_elements(public.bloom_admin_payouts()->'people') x where x->>'id'=c::text) then raise exception 'Historic participant disappeared';end if;
 update public.users set role='cleaner' where id=c;
 -- Public completion retry preserves one participant snapshot and produces no new earning.
 update public.properties set cleaning_config='{"version":1,"rooms":[],"supplies":[]}' where id=p;
 insert into public.jobs(property_id,checkout_date,start_at,end_at,timezone_snapshot,solo_rate_cents_snapshot,cleaning_config,started_at) values(p,current_date-100,(current_date-100+time '11:00') at time zone 'America/Detroit',(current_date-100+time '15:00') at time zone 'America/Detroit','America/Detroit',12300,'{"version":1,"rooms":[],"supplies":[]}',now()-interval '1 hour') returning id into j;
 insert into public.assignments(job_id,cleaner_id,slot) values(j,a.id,1);
 payload:=jsonb_build_object('configVersion',1,'answers','[]'::jsonb,'notes','LOCAL TEST actual completion retry','maintenance',(select jsonb_agg(jsonb_build_object('category',x,'status','ok','notes','')) from unnest(array['painting','fridge','electricity','wifi','tv','garage','climate','water']) x));
 result:=public.bloom_job_action(j,'complete','payout-complete',null,payload);
 perform public.bloom_job_action(j,'complete','payout-complete',null,payload);
 perform public.bloom_job_action(j,'complete','payout-complete-retry',null,payload);
 if (select count(*) from private.payout_balances where job_id=j)<>1 or (select completed_pay_cents from private.payout_balances where job_id=j)<>12300 then raise exception 'Completion replay earnings incorrect';end if;
 -- Cleaner self-service reads exactly the Admin ledger, including early/partial payments and voids.
 detail:=public.bloom_admin_payouts(c);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select clerk_user_id from public.users where id=c))::text,true);
 result:=public.bloom_cleaner_payouts();
 if result-'nextPayoutAt'-'payoutTimezone'<>detail then raise exception 'Cleaner/admin ledger mismatch';end if;
 if (result->>'id')::uuid<>c then raise exception 'Other cleaner data leaked';end if;
 if extract(isodow from (result->>'nextPayoutAt')::timestamptz at time zone 'America/Detroit')<>1 or extract(hour from (result->>'nextPayoutAt')::timestamptz at time zone 'America/Detroit')<>8 or (result->>'nextPayoutAt')::timestamptz<=now() then raise exception 'Invalid Monday schedule';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select clerk_user_id from public.users where id=c2))::text,true);
 result:=public.bloom_cleaner_payouts();
 if (result->>'totalDueCents')::integer<>5800 or jsonb_array_length(result->'cleanings')<>1 then raise exception 'Cleaner isolation failed';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select clerk_user_id from public.users where id=o))::text,true);
 begin perform public.bloom_cleaner_payouts();raise exception 'Owner self read allowed';exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 if has_function_privilege('authenticated','private.payout_detail(uuid)','EXECUTE') or has_function_privilege('anon','public.bloom_cleaner_payouts()','EXECUTE') then raise exception 'Self payout grant leak';end if;
 -- Owners and other cleaners are denied by the actual RPC role check.
 for i in 1..2 loop
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select clerk_user_id from public.users where id=case when i=1 then c else o end))::text,true);
 begin perform public.bloom_admin_payouts();raise exception 'Non-admin read allowed';exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 begin perform public.bloom_admin_payout_action(c,'preference','{"method":"Cash"}','denied');raise exception 'Non-admin write allowed';exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 end loop;
 if has_table_privilege('authenticated','private.payout_payments','SELECT') or has_function_privilege('anon','public.bloom_admin_payouts(uuid)','EXECUTE') then raise exception 'Payout grant leak';end if;
 raise notice 'Payout snapshot, solo/shared, repeated unit, unfinished exclusion, full/partial, adjustment, void audit, retries, historical rate preservation and non-admin denials passed';
end $$;
rollback;
