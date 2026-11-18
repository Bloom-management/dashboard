-- Expose the next guest arrival after a cleaning so cleaners see the hard deadline.
-- Imported reservations carry dates only, so they use the property's default check-in time;
-- direct bookings keep the check-in time captured when they were created.
create function private.job_next_check_in(p_job uuid) returns timestamptz language sql stable security definer set search_path='' as $$
 with j as (select * from public.jobs where id=p_job),
 props as (
  select p.id,p.timezone,p.default_checkin_time from public.properties p,j
  where p.id=j.property_id or (j.house_id is not null and p.house_id=j.house_id)
 )
 select min(arrival) from (
  select (ce.start_local_date+p.default_checkin_time) at time zone p.timezone arrival
  from j,public.calendar_events ce join public.calendar_sources s on s.id=ce.source_id join props p on p.id=s.property_id
  where s.enabled and ce.kind='reservation' and ce.source_status='active'
   and ce.start_local_date between j.checkout_date and j.checkout_date+60
  union all
  select (b.check_in+b.checkin_time) at time zone b.timezone
  from j,private.manual_bookings b join props p on p.id=b.property_id
  where b.status='active' and b.check_in between j.checkout_date and j.checkout_date+60
 ) arrivals where arrival>=(select end_at from j)-interval '12 hours'
$$;

alter function private.job_dto(uuid) rename to job_dto_before_check_in;
create function private.job_dto(p_job uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select private.job_dto_before_check_in(p_job)||jsonb_build_object('checkInAt',private.job_next_check_in(p_job))
$$;

revoke all on function private.job_next_check_in(uuid),private.job_dto_before_check_in(uuid),private.job_dto(uuid) from public,anon,authenticated,service_role;
