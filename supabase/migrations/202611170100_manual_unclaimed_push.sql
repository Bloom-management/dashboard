begin;
-- Service-only manual run of the cleaner "still unclaimed" alert for jobs checking out in p_days
-- (property-local days from today). Same eligibility as the scheduled 08:00 check. By default it
-- respects the per-recipient/job/day ledger; p_resend skips that dedupe for an explicit re-send.
create or replace function public.bloom_push_notify_unclaimed(p_days integer[] default '{1,2,3}',p_resend boolean default false) returns integer language plpgsql security definer set search_path='' as $$
declare ids uuid[];u record;mine uuid[];run text:='unclaimed:manual:'||now();sent integer:=0;begin
 select array_agg(j.id) into ids from public.jobs j
 where j.checkout_date-(now() at time zone j.timezone_snapshot)::date=any(p_days) and j.started_at is null
  and private.push_claimable(j.id,now()) and not exists(select 1 from public.assignments a where a.job_id=j.id and a.ended_at is null);
 if cardinality(ids) is null then return 0;end if;
 if not p_resend then
  perform private.notify_opportunities(ids,'unclaimed',run,now());
  return (select count(*) from private.notification_events where event_key=run);
 end if;
 for u in select * from public.users where role='cleaner' and bloom_network_enabled and bloom_pool_approved loop
  select array_agg(j.id) into mine from public.jobs j join public.properties p on p.id=j.property_id
  where j.id=any(ids) and p.city_id=u.approved_city_id;
  if cardinality(mine)>0 then
   insert into private.opportunity_notifications(job_id,user_id,local_day)
    select j.id,u.id,(now() at time zone j.timezone_snapshot)::date from public.jobs j where j.id=any(mine) on conflict do nothing;
   perform private.notification_emit(run,u.id,'unclaimed','unclaimed',null,null,jsonb_build_object('jobs',to_jsonb(mine)),now()+interval '24 hours');
   sent:=sent+1;
  end if;
 end loop;
 return sent;
end $$;
revoke all on function public.bloom_push_notify_unclaimed(integer[],boolean) from public,anon,authenticated;
grant execute on function public.bloom_push_notify_unclaimed(integer[],boolean) to service_role;
commit;
