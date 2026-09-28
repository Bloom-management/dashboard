begin;
-- Only newly recorded payments notify; historical records are not backfilled.
create table private.payout_notification_events (
 payment_id uuid primary key references private.payout_payments(id),
 batch_id uuid not null,
 recorded_at timestamptz not null default clock_timestamp()
);
alter table private.payout_notification_events enable row level security;
revoke all on private.payout_notification_events from public,anon,authenticated,service_role;
create function private.notify_recorded_payment() returns trigger
language plpgsql security definer set search_path='' as $$
declare batch uuid;begin
 -- Serialize grouping for a recipient, including direct administrative inserts.
 perform pg_advisory_xact_lock(hashtextextended(new.cleaner_id::text,47));
 select e.batch_id into batch from private.payout_notification_events e
 join private.payout_payments p on p.id=e.payment_id
 where p.cleaner_id=new.cleaner_id and p.payer_owner_id is not distinct from new.payer_owner_id
 and e.recorded_at>=clock_timestamp()-interval '5 minutes'
 order by e.recorded_at desc,e.payment_id desc limit 1;
 insert into private.payout_notification_events(payment_id,batch_id) values(new.id,coalesce(batch,gen_random_uuid()));
 return new;
end $$;
revoke all on function private.notify_recorded_payment() from public,anon,authenticated,service_role;
create trigger payout_payment_notification after insert on private.payout_payments
for each row execute function private.notify_recorded_payment();
alter function private.inbox_items() rename to inbox_items_before_payments;
create function private.inbox_items() returns table(id text,body text,href text,dismissible boolean)
language plpgsql stable security definer set search_path='' as $$
declare actor public.users;begin
 actor:=private.require_actor();
 return query select i.id,i.body,i.href,i.dismissible from private.inbox_items_before_payments() i;
 return query
 select 'payment:'||e.batch_id::text||':'||count(*)::text,
 case when count(*) filter(where v.payment_id is null)=1 then
 'A payment of $'||to_char(sum(p.amount_cents) filter(where v.payment_id is null)/100.0,'FM999999999990.00')||' was made from '
 else (count(*) filter(where v.payment_id is null))::text||' payments were made from ' end
 ||case when p.payer_owner_id is null then 'Bloom' else coalesce(nullif(u.display_name,''),'your host') end,
 '/cleaner?view=payouts&history=payments&payer='||coalesce(p.payer_owner_id::text,'bloom'),true
 from private.payout_notification_events e join private.payout_payments p on p.id=e.payment_id
 left join private.payout_voids v on v.payment_id=p.id left join public.users u on u.id=p.payer_owner_id
 where p.cleaner_id=actor.id
 group by e.batch_id,p.payer_owner_id,u.display_name
 having count(*) filter(where v.payment_id is null)>0;
end $$;
revoke all on function private.inbox_items(),private.inbox_items_before_payments() from public,anon,authenticated,service_role;
commit;
