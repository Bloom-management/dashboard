begin;
-- A published room's stored bookings get cleanings even when the provider answers "not modified".
-- Before this, cleanings were attached only when a sync re-read the feed, so bookings stored while
-- the room was a draft stayed without cleanings for as long as Airbnb kept replying 304.
create function private.room_attach_missing(p_source uuid) returns integer language plpgsql security definer set search_path='' as $$
declare p public.properties;e public.calendar_events;jid uuid;n integer:=0;begin
 select prop.* into p from public.properties prop join public.calendar_sources s on s.property_id=prop.id where s.id=p_source and s.enabled;
 if p.id is null or p.listing_type<>'room' or p.house_id is null or not p.active or p.draft_data is not null or p.deleted_at is not null or p.archived_at is not null then return 0;end if;
 for e in select ev.* from public.calendar_events ev where ev.source_id=p_source and ev.source_status='active' and ev.event_status<>'cancelled'
  and ev.end_local_date>=(now() at time zone p.timezone)::date and private.calendar_job_eligible(ev)
  and not exists(select 1 from private.room_turnovers t where t.event_id=ev.id) order by ev.end_local_date,ev.id loop
  begin
   jid:=private.room_turnover_attach(p.id,e.end_local_date,(e.end_local_date+greatest(p.cleaning_start_time,p.default_checkout_time)) at time zone p.timezone,(e.end_local_date+p.cleaning_end_time) at time zone p.timezone,e.id);
   insert into public.job_events(job_id,event_id) values(jid,e.id) on conflict do nothing;n:=n+1;
  exception when others then null; -- A room needing setup or review must not fail the whole sync.
  end;
 end loop;
 return n;
end$$;
revoke all on function private.room_attach_missing(uuid) from public,anon,authenticated,service_role;

create or replace function public.bloom_calendar_finish_sync(p_actor uuid,p_source uuid,p_run uuid,p_version bigint,p_snapshot jsonb,p_validators jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare hid uuid;r jsonb;begin
 select p.house_id into hid from public.properties p join public.calendar_sources s on s.property_id=p.id where s.id=p_source;
 if hid is not null then perform pg_advisory_xact_lock(hashtextextended('house-visit:'||hid,0));end if;
 r:=public.bloom_calendar_finish_before_visits(p_actor,p_source,p_run,p_version,p_snapshot,p_validators);
 if hid is not null and r->>'status'='not_modified' then perform private.room_attach_missing(p_source);end if;
 return r;
end$$;

alter function public.bloom_owner_calendar_finish_sync(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb) rename to bloom_owner_calendar_finish_before_missing;
revoke all on function public.bloom_owner_calendar_finish_before_missing(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.bloom_owner_calendar_finish_sync(p_actor uuid,p_property uuid,p_source uuid,p_run uuid,p_version bigint,p_snapshot jsonb,p_validators jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare hid uuid;r jsonb;begin
 select house_id into hid from public.properties where id=p_property;
 if hid is not null then perform pg_advisory_xact_lock(hashtextextended('house-visit:'||hid,0));end if;
 r:=public.bloom_owner_calendar_finish_before_missing(p_actor,p_property,p_source,p_run,p_version,p_snapshot,p_validators);
 if hid is not null and r->>'status'='not_modified' then perform private.room_attach_missing(p_source);end if;
 return r;
end$$;
revoke all on function public.bloom_owner_calendar_finish_sync(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.bloom_owner_calendar_finish_sync(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb) to service_role;
commit;
