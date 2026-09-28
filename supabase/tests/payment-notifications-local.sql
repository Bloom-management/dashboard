\set ON_ERROR_STOP on
begin;
do $$
declare c public.users; other_id uuid; host_id uuid; p1 uuid;p2 uuid;p3 uuid; notice text;n integer;begin
 insert into public.users(clerk_user_id,role,display_name) values('payment-test-'||gen_random_uuid(),'cleaner','Payment recipient') returning * into c;
 insert into public.users(clerk_user_id,role,display_name) values('payment-other-'||gen_random_uuid(),'cleaner','Other recipient') returning id into other_id;
 insert into public.users(clerk_user_id,role,display_name) values('payment-host-'||gen_random_uuid(),'owner','Test host') returning id into host_id;
 update public.users set onboarding_completed_at=now() where id=c.id;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',c.clerk_user_id)::text,true);
 insert into private.payout_payments(cleaner_id,amount_cents,method,payment_date,entered_by) values(c.id,3750,'Cash',current_date,host_id) returning id into p1;
 if not exists(select 1 from private.inbox_items() where body='A payment of $37.50 was made from Bloom') then raise exception 'Single payment missing';end if;
 select id into notice from private.inbox_items() where id like 'payment:%';
 perform public.bloom_notification_dismiss(notice);
 insert into private.payout_payments(cleaner_id,amount_cents,method,payment_date,entered_by) values(c.id,7500,'Cash',current_date,host_id) returning id into p2;
 select count(*) into n from private.inbox_items() where id like 'payment:%';
 if n<>1 or not exists(select 1 from private.inbox_items() where body='2 payments were made from Bloom' and id<>notice) then raise exception 'Grouping or renewed notice failed';end if;
 insert into private.payout_payments(cleaner_id,payer_owner_id,amount_cents,method,payment_date,entered_by) values(c.id,host_id,1500,'Cash',current_date,host_id) returning id into p3;
 if not exists(select 1 from private.inbox_items() where body='A payment of $15.00 was made from Test host' and href like '%payer='||host_id::text) then raise exception 'Host separation failed';end if;
 insert into private.payout_payments(cleaner_id,amount_cents,method,payment_date,entered_by) values(other_id,900,'Cash',current_date,host_id);
 select count(*) into n from private.inbox_items() where id like 'payment:%';if n<>2 then raise exception 'Recipient isolation failed';end if;
 update private.payout_notification_events set recorded_at=clock_timestamp()-interval '6 minutes';
 insert into private.payout_payments(cleaner_id,amount_cents,method,payment_date,entered_by) values(c.id,500,'Cash',current_date,host_id);
 select count(*) into n from private.inbox_items() where id like 'payment:%';if n<>3 then raise exception 'Time window failed';end if;
 insert into private.payout_voids(payment_id,reason,entered_by) values(p3,'Test correction',host_id);
 if exists(select 1 from private.inbox_items() where body like '%Test host') then raise exception 'Voided notification remains';end if;
 insert into private.payout_voids(payment_id,reason,entered_by) values(p2,'Test correction',host_id);
 if not exists(select 1 from private.inbox_items() where body='A payment of $37.50 was made from Bloom') then raise exception 'Partial batch void failed';end if;
 if has_table_privilege('authenticated','private.payout_notification_events','SELECT') then raise exception 'Event table exposed';end if;
 raise notice 'Payment grouping, payer/recipient isolation, dismissal renewal, time window, void handling and ACL passed';
end $$;
rollback;
