begin;
-- Rooms in a house share one visit when they check out the same day, or one day apart.
-- One day apart: both rooms are cleaned on the later checkout day, unless a guest checks into
-- the earlier room on its own checkout day. Visits pair at most two consecutive days (no chains).
-- Everyone on the visit (admins, house owners, assigned cleaners) is told when rooms are grouped.

alter table private.room_turnovers add column own_checkout date;
update private.room_turnovers set own_checkout=checkout_date;
create function private.room_turnover_own_checkout() returns trigger language plpgsql security definer set search_path='' as $$
begin new.own_checkout:=coalesce(new.own_checkout,new.checkout_date);return new;end$$;
create trigger room_turnover_own_checkout before insert on private.room_turnovers for each row execute function private.room_turnover_own_checkout();
alter table private.room_turnovers alter column own_checkout set not null;

-- A guest arrives in this room on this day (calendar reservation or manual booking).
create function private.room_checkin_on(p_property uuid,p_day date) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.calendar_events e join public.calendar_sources s on s.id=e.source_id
  where s.property_id=p_property and s.enabled and e.source_status='active' and e.event_status<>'cancelled' and e.kind='reservation' and e.start_local_date=p_day)
 or exists(select 1 from private.manual_bookings b where b.property_id=p_property and b.status='active' and b.check_in=p_day)
$$;

-- The room's normal cleaning window on a day, matching calendar-imported turnovers.
create function private.room_visit_window(p_property uuid,p_day date) returns tstzrange language sql stable security definer set search_path='' as $$
 select tstzrange((p_day+greatest(p.cleaning_start_time,p.default_checkout_time)) at time zone p.timezone,(p_day+p.cleaning_end_time) at time zone p.timezone) from public.properties p where p.id=p_property
$$;

alter function private.room_turnover_attach(uuid,date,timestamptz,timestamptz,uuid,uuid,text,text,boolean,jsonb) rename to room_turnover_attach_on_day;
alter function private.room_turnover_cancel(uuid,text) rename to room_turnover_cancel_before_pairing;

-- Move an existing turnover to another visit day (same identity, instructions kept).
create function private.room_turnover_move(p_turnover uuid,p_day date) returns uuid language plpgsql security definer set search_path='' as $$
declare t private.room_turnovers;w tstzrange;begin
 select * into t from private.room_turnovers where id=p_turnover;w:=private.room_visit_window(t.property_id,p_day);
 return private.room_turnover_attach_on_day(t.property_id,p_day,lower(w),upper(w),t.event_id,t.booking_id,t.manual_key,t.instructions,false,null);
end$$;

-- A visit holding only rooms that checked out earlier has lost its reason to wait: send them back to their own day.
create function private.room_visit_settle(p_job uuid) returns void language plpgsql security definer set search_path='' as $$
declare j public.jobs;t private.room_turnovers;begin
 select * into j from public.jobs where id=p_job;
 if j.id is null or j.house_id is null or j.status<>'open' then return;end if;
 if exists(select 1 from private.room_turnovers where job_id=p_job and state<>'cancelled' and own_checkout=j.checkout_date) then return;end if;
 for t in select * from private.room_turnovers where job_id=p_job and state<>'cancelled' and own_checkout<j.checkout_date order by id loop
  perform private.room_turnover_move(t.id,t.own_checkout);end loop;
end$$;

-- A guest now arrives on the room's own checkout day: it must be cleaned that day, not with the next day's visit.
create function private.room_visit_recheck(p_property uuid) returns void language plpgsql security definer set search_path='' as $$
declare t private.room_turnovers;begin
 for t in select rt.* from private.room_turnovers rt join public.jobs j on j.id=rt.job_id
  where rt.property_id=p_property and rt.state<>'cancelled' and j.status='open' and rt.own_checkout<j.checkout_date and private.room_checkin_on(p_property,rt.own_checkout) order by rt.id loop
  perform private.room_turnover_move(t.id,t.own_checkout);end loop;
end$$;

create function private.room_visit_grouped_notice(p_job uuid) returns void language plpgsql security definer set search_path='' as $$
declare j public.jobs;rooms text;ids text;early text;body text;event text;a record;house text;begin
 select * into j from public.jobs where id=p_job;
 if j.id is null or j.status<>'open' or (select count(*) from private.room_turnovers where job_id=p_job and state in ('accepted','pending'))<2 then return;end if;
 select string_agg(p.room_identifier,' & ' order by p.room_identifier),string_agg(t.id::text,',' order by t.id),
  string_agg(case when t.own_checkout<j.checkout_date then p.room_identifier||' checks out '||to_char(t.own_checkout,'Mon FMDD') end,', ' order by p.room_identifier)
 into rooms,ids,early from private.room_turnovers t join public.properties p on p.id=t.property_id where t.job_id=p_job and t.state in ('accepted','pending');
 body:=rooms||' will be cleaned in one visit.'||coalesce(' '||early||'.','');event:='grouped:'||md5(ids||':'||j.checkout_date);
 perform private.visit_notice(p_job,event,body);
 select name into house from public.houses where id=j.house_id;
 for a in select distinct cleaner_id from public.assignments where job_id=p_job and ended_at is null loop
  perform private.visit_notice(p_job,event,house||' · '||to_char(j.checkout_date,'Mon FMDD, YYYY')||' · '||body,a.cleaner_id);end loop;
end$$;

create function private.room_turnover_attach(p_property uuid,p_day date,p_start timestamptz,p_end timestamptz,p_event uuid default null,p_booking uuid default null,p_manual text default null,p_instructions text default '',p_coordinated boolean default false,p_config jsonb default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.properties;w tstzrange;jid uuid;prior uuid;early private.room_turnovers;deferred boolean:=false;begin
 select * into p from public.properties where id=p_property;
 -- Coordinated (admin-scheduled) cleanings keep the exact day they were given.
 if p_coordinated or p.house_id is null or p.listing_type<>'room' then
  return private.room_turnover_attach_on_day(p_property,p_day,p_start,p_end,p_event,p_booking,p_manual,p_instructions,p_coordinated,p_config);end if;
 perform pg_advisory_xact_lock(hashtextextended('house-visit:'||p.house_id,0));
 perform private.room_visit_recheck(p.id);
 select job_id into prior from private.room_turnovers where (p_event is not null and event_id=p_event) or (p_booking is not null and booking_id=p_booking) or (p_manual is not null and property_id=p.id and manual_key=p_manual);
 -- Wait for the next day's visit: another room checks out then (and leads that visit), nobody else checks out today, and no guest arrives here today.
 if not private.room_checkin_on(p.id,p_day)
  and not exists(select 1 from private.room_turnovers o join public.jobs j on j.id=o.job_id where o.house_id=p.house_id and o.property_id<>p.id and o.state<>'cancelled' and j.status='open' and j.checkout_date=p_day)
  and exists(select 1 from private.room_turnovers o join public.jobs j on j.id=o.job_id where o.house_id=p.house_id and o.property_id<>p.id and o.state in ('accepted','pending') and j.status='open' and j.checkout_date=p_day+1 and o.own_checkout=p_day+1) then
  deferred:=true;w:=private.room_visit_window(p.id,p_day+1);
  jid:=private.room_turnover_attach_on_day(p_property,p_day+1,lower(w),upper(w),p_event,p_booking,p_manual,p_instructions,false,p_config);
 else
  jid:=private.room_turnover_attach_on_day(p_property,p_day,p_start,p_end,p_event,p_booking,p_manual,p_instructions,false,p_config);
 end if;
 update private.room_turnovers set own_checkout=p_day where ((p_event is not null and event_id=p_event) or (p_booking is not null and booking_id=p_booking) or (p_manual is not null and property_id=p.id and manual_key=p_manual)) and own_checkout is distinct from p_day;
 -- Pull in a lone, unclaimed room that checked out the day before and has no guest arriving that day.
 if not deferred and exists(select 1 from public.jobs where id=jid and checkout_date=p_day and status='open') then
  for early in select o.* from private.room_turnovers o join public.jobs j on j.id=o.job_id
   where o.house_id=p.house_id and o.property_id<>p.id and o.state in ('accepted','pending') and j.status='open' and j.started_at is null and j.checkout_date=p_day-1 and o.own_checkout=p_day-1
    and not exists(select 1 from public.assignments a where a.job_id=j.id and a.ended_at is null)
    and (select count(*) from private.room_turnovers x where x.job_id=j.id and x.state<>'cancelled')=1
    and not private.room_checkin_on(o.property_id,p_day-1) order by o.id loop
   perform private.room_turnover_move(early.id,p_day);end loop;
 end if;
 if prior is not null and prior is distinct from jid then perform private.room_visit_settle(prior);end if;
 perform private.room_visit_grouped_notice(jid);
 return jid;
end$$;

create function private.room_turnover_cancel(p_turnover uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare jid uuid;hid uuid;begin
 select job_id,house_id into jid,hid from private.room_turnovers where id=p_turnover;
 perform pg_advisory_xact_lock(hashtextextended('house-visit:'||hid,0));
 perform private.room_turnover_cancel_before_pairing(p_turnover,p_reason);
 if jid is not null then perform private.room_visit_settle(jid);end if;
end$$;

revoke all on function private.room_turnover_own_checkout(),private.room_checkin_on(uuid,date),private.room_visit_window(uuid,date),
 private.room_turnover_attach_on_day(uuid,date,timestamptz,timestamptz,uuid,uuid,text,text,boolean,jsonb),private.room_turnover_cancel_before_pairing(uuid,text),
 private.room_turnover_move(uuid,date),private.room_visit_settle(uuid),private.room_visit_recheck(uuid),private.room_visit_grouped_notice(uuid),
 private.room_turnover_attach(uuid,date,timestamptz,timestamptz,uuid,uuid,text,text,boolean,jsonb),private.room_turnover_cancel(uuid,text) from public,anon,authenticated,service_role;
commit;
