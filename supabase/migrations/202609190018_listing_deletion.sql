begin;
alter table public.properties add column deleted_at timestamptz;
create policy properties_not_deleted on public.properties as restrictive for select to authenticated using (deleted_at is null);
create table private.listing_deletions(property_id uuid primary key references public.properties,actor_id uuid not null references public.users,deleted_at timestamptz not null,cancelled_jobs integer not null);
alter table private.listing_deletions enable row level security;
revoke all on private.listing_deletions from public,anon,authenticated,service_role;

-- Property -> sources (UUID) -> jobs (UUID) -> actor/membership; claims never request property locks.
create function public.bloom_property_delete(p_property uuid,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.users;p public.properties;j public.jobs;b jsonb;r jsonb;i jsonb;n integer:=0;t timestamptz;
begin
 u:=private.require_actor();if u.role not in ('admin','owner') then raise exception 'FORBIDDEN';end if;
 select * into p from public.properties where id=p_property for update;if not found then raise exception 'NOT_FOUND';end if;
 -- Refuse foreign owners before acquiring unrelated source/job locks.
 if u.role='owner' and not exists(select 1 from public.property_owners where property_id=p.id and owner_id=u.id) then raise exception 'NOT_FOUND';end if;
 perform 1 from public.calendar_sources where property_id=p.id order by id for update;
 perform 1 from public.jobs where property_id=p.id order by id for update;
 select * into u from public.users where id=u.id for share;
 if u.role not in ('admin','owner') then raise exception 'FORBIDDEN';end if;
 if u.role='owner' then perform 1 from public.property_owners where property_id=p.id and owner_id=u.id for share;if not found then raise exception 'NOT_FOUND';end if;end if;
 i:=jsonb_build_object('propertyId',p.id);r:=private.receipt('property_delete',p_key,i);if r is not null then return r;end if;
 if p.deleted_at is not null then return private.save_receipt('property_delete',p_key,i,jsonb_build_object('id',p.id,'deleted',true));end if;
 if exists(select 1 from public.jobs x join public.assignments a on a.job_id=x.id where x.property_id=p.id and x.status='open' and a.ended_at is null) then raise exception 'CONFLICT';end if;
 t:=clock_timestamp();
 for j in select * from public.jobs where property_id=p.id and status='open' order by id loop
 b:=private.job_snapshot(j.id);
 update public.jobs set status='cancelled',cancellation_origin='admin',review_required=false,version=version+1,updated_at=t where id=j.id;
 perform private.audit(j.id,'listing_deleted',b,p_key,jsonb_build_object('reason','Listing deleted; unassigned cleaning cancelled.'));n:=n+1;
 end loop;
 update public.calendar_sync_runs set status='failed',error_code='SYNC_FAILED',completed_at=t where status='running' and source_id in(select id from public.calendar_sources where property_id=p.id);
 update public.calendar_sources set enabled=false,sync_version=sync_version+1,active_run_id=null,lease_expires_at=null,updated_at=t where property_id=p.id;
 delete from private.pending_property_owners where property_id=p.id and claimed_by is null;
 update public.properties set active=false,deleted_at=t,updated_at=t where id=p.id;
 insert into private.listing_deletions values(p.id,u.id,t,n);
 return private.save_receipt('property_delete',p_key,i,jsonb_build_object('id',p.id,'deleted',true));
end $$;
revoke all on function public.bloom_property_delete(uuid,text) from public,anon,service_role;
grant execute on function public.bloom_property_delete(uuid,text) to authenticated;

-- Deleted listings cannot be revived by existing edit, calendar or job paths.
create function private.deleted_listing_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_TABLE_NAME='properties' then
 if old.deleted_at is not null then raise exception 'NOT_FOUND';end if;
 elsif TG_TABLE_NAME='calendar_sources' then
 if new.enabled and exists(select 1 from public.properties where id=new.property_id and deleted_at is not null) then raise exception 'NOT_FOUND';end if;
 elsif TG_TABLE_NAME='jobs' then
 if (TG_OP='INSERT' or new.status='open') and exists(select 1 from public.properties where id=new.property_id and deleted_at is not null) then raise exception 'NOT_FOUND';end if;
 end if;return new;
end $$;
revoke all on function private.deleted_listing_guard() from public,anon,authenticated,service_role;
create trigger deleted_property_guard before update on public.properties for each row execute function private.deleted_listing_guard();
create trigger deleted_source_guard before insert or update on public.calendar_sources for each row execute function private.deleted_listing_guard();
create trigger deleted_job_guard before insert or update on public.jobs for each row execute function private.deleted_listing_guard();

create or replace function public.bloom_admin_property_options(p_id uuid default null,p_cursor uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.require_actor('admin');
 with page as (select p.* from public.properties p where p.deleted_at is null and (p_id is null or p.id=p_id) and (p_cursor is null or p.id>p_cursor) order by p.id limit 101),
 shown as (select * from page order by id limit 100)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
 'id',p.id,'name',p.name,'cityId',p.city_id,'timezone',p.timezone,'address',p.address,'isBloomOwned',p.is_bloom_owned,'active',p.active,
 'soloRateCents',p.solo_rate_cents,'instructions',coalesce((select instructions from public.property_entry_instructions where property_id=p.id),''),
 'pendingOwnerEmail',(select email from private.pending_property_owners where property_id=p.id and claimed_by is null),
 'ownerIds',coalesce((select jsonb_agg(owner_id order by owner_id) from public.property_owners where property_id=p.id),'[]'::jsonb)) order by p.id) from shown p),'[]'::jsonb),
 'nextCursor',case when (select count(*) from page)>100 then (select max(id::text) from shown) else null end) into result;
 return result;
end $$;

create or replace function public.bloom_owner_listings(p_cursor uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u public.users;r jsonb;begin
 u:=private.require_actor('owner');
 with page as (select p.* from public.properties p join public.property_owners po on po.property_id=p.id where p.deleted_at is null and po.owner_id=u.id and (p_cursor is null or p.id>p_cursor) order by p.id limit 101),
 shown as (select * from page order by id limit 100)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
 'id',p.id,'name',p.name,'timezone',p.timezone,'active',p.active,'nightlyGuestRateCents',null,'hostPayoutCents',null,'currency','USD',
 'supplies',coalesce((select jsonb_agg(jsonb_build_object('supplyId',c.value->>'id','name',c.value->>'name','level',r.level,'reportedAt',r.reported_at) order by c.ordinality)
 from jsonb_array_elements(coalesce(p.cleaning_config->'supplies','[]'::jsonb)) with ordinality c(value,ordinality)
 left join lateral (select x.level,x.reported_at from public.job_supply_reports x join public.jobs j on j.id=x.job_id
 where j.property_id=p.id and j.status='completed' and x.supply_id=(c.value->>'id')::uuid order by j.completed_at desc,x.reported_at desc,j.id desc limit 1) r on true),'[]'::jsonb),
 'sources',coalesce((select jsonb_agg(private.owner_source(s.id) order by s.id) from public.calendar_sources s where s.property_id=p.id),'[]'::jsonb)
 ) order by p.id) from shown p),'[]'::jsonb),
 'nextCursor',case when (select count(*) from page)>100 then (select max(id::text) from shown) else null end) into r;
 return r;
end $$;

create or replace function public.bloom_owner_source_freshness(p_cursor uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u public.users;begin
 u:=private.require_actor('owner');
 return (select coalesce(jsonb_agg(jsonb_build_object('propertyId',page.id,'lastSuccessAt',h.success_at,'message',h.message) order by page.id),'[]')
 from (select p.id from public.properties p join public.property_owners po on po.property_id=p.id where p.deleted_at is null and po.owner_id=u.id and (p_cursor is null or p.id>p_cursor) order by p.id limit 100) page
 cross join lateral (select
 case when count(*)=0 or count(last_success_at)<count(*) then null else min(last_success_at) end success_at,
 case when count(*)=0 then 'Calendar source not configured.'
 when bool_or(last_error_code is not null or (active_run_id is not null and lease_expires_at<=now())) then 'Calendar update needs attention.'
 when bool_or(active_run_id is not null and lease_expires_at>now()) then 'Calendar update in progress.'
 when count(last_success_at)<count(*) then 'Calendar has not been checked.'
 else 'Calendar checked successfully.' end message
 from public.calendar_sources where property_id=page.id and enabled) h);
end $$;

create or replace function public.bloom_owner_calendar(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u public.users;begin
 u:=private.require_actor('owner');if p_from is null or p_to is null or p_to<p_from or p_to-p_from>92 then raise exception 'VALIDATION_ERROR';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'propertyId',p.id,'propertyName',p.name,'timezone',p.timezone,
 'startDate',e.start_local_date,'endDate',e.end_local_date,'providers',jsonb_build_array(s.provider),'kind',e.kind,'removed',e.source_status='removed',
 'changes',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'type',c.type,'message',case c.type when 'removed' then 'Calendar block removed.' when 'changed' then 'Calendar dates changed.' else 'Calendar dates need review.' end,'acknowledged',c.acknowledged_at is not null) order by c.created_at,c.id),'[]') from public.calendar_changes c where c.event_id=e.id)) order by e.start_local_date,e.id),'[]')
 from public.calendar_events e join public.calendar_sources s on s.id=e.source_id join public.properties p on p.id=s.property_id
 where p.deleted_at is null and exists(select 1 from public.property_owners po where po.property_id=p.id and po.owner_id=u.id)
 and e.start_local_date<=p_to and e.end_local_date>=p_from);end $$;

create or replace function public.bloom_owner_analytics(p_from date,p_to_exclusive date,p_properties uuid[] default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u public.users;ids uuid[];r jsonb;begin
 u:=private.require_actor('owner');
 if p_from is null or p_to_exclusive is null or not isfinite(p_from) or not isfinite(p_to_exclusive) or p_to_exclusive-p_from not between 1 and 366
 or (p_properties is not null and (cardinality(p_properties)>100 or array_position(p_properties,null) is not null)) then raise exception 'VALIDATION_ERROR';end if;
 if p_properties is not null and exists(select 1 from unnest(p_properties) x where not exists(select 1 from public.property_owners po where po.property_id=x and po.owner_id=u.id and exists(select 1 from public.properties ap where ap.id=po.property_id and ap.deleted_at is null))) then raise exception 'NOT_FOUND';end if;
 select coalesce(array_agg(p.id order by p.id),'{}'::uuid[]) into ids from public.properties p join public.property_owners po on po.property_id=p.id where p.deleted_at is null and po.owner_id=u.id and (p_properties is null or p.id=any(p_properties));
 -- An oversized portfolio must be explicitly narrowed, never silently truncated.
 if cardinality(ids)>100 then raise exception 'VALIDATION_ERROR';end if;
 if (select count(*) from public.calendar_events e join public.calendar_sources s on s.id=e.source_id where s.property_id=any(ids) and e.start_local_date<p_to_exclusive and (e.end_local_date>p_from or e.start_local_date>=p_from))>50000 then raise exception 'VALIDATION_ERROR';end if;
 select jsonb_build_object('properties',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'timezone',p.timezone,'coverage','[]'::jsonb) order by p.id) from public.properties p where p.id=any(ids)),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'propertyId',s.property_id,'startDate',e.start_local_date,'endDate',e.end_local_date,'kind',e.kind,
 'removed',e.source_status='removed','confirmed',e.kind='reservation' and e.evidence='airbnb-reservation-link' and not e.review_required,
 'origin',case when e.kind='reservation' and e.evidence='airbnb-reservation-link' and not e.review_required then 'airbnb' else 'unknown' end) order by e.id)
 from public.calendar_events e join public.calendar_sources s on s.id=e.source_id where s.property_id=any(ids) and e.start_local_date<p_to_exclusive and (e.end_local_date>p_from or e.start_local_date>=p_from)),'[]'::jsonb)) into r;
 return r;
end $$;

create or replace function private.owner_calendar_property(p_actor uuid,p_property uuid,p_source uuid default null)
returns public.properties language plpgsql security definer set search_path='' as $$
declare p public.properties;begin
 if auth.role() is distinct from 'service_role' or current_setting('role',true) is distinct from 'service_role' or p_actor is null then perform private.calendar_error('FORBIDDEN');end if;
 select * into p from public.properties where id=p_property and deleted_at is null for update;
 if not found then perform private.calendar_error('NOT_FOUND');end if;
 perform 1 from public.users where id=p_actor and role='owner' for share;
 if not found then perform private.calendar_error('FORBIDDEN');end if;
 perform 1 from public.property_owners where property_id=p_property and owner_id=p_actor for share;
 if not found then perform private.calendar_error('NOT_FOUND');end if;
 if p_source is not null and not exists(select 1 from public.calendar_sources where id=p_source and property_id=p_property and provider='airbnb') then perform private.calendar_error('NOT_FOUND');end if;
 return p;
end $$;

create or replace function public.bloom_calendar_property_sources(p_actor uuid,p_property uuid,p_cursor uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.calendar_actor(p_actor,true);
 if not exists(select 1 from public.properties where id=p_property and deleted_at is null) then perform private.calendar_error('NOT_FOUND');end if;
 select jsonb_build_object('items',coalesce(jsonb_agg(private.calendar_health(s.id) order by s.id),'[]'::jsonb),
 'nextCursor',case when count(*)=100 then max(s.id::text) else null end) into result
 from (select id from public.calendar_sources where property_id=p_property and (p_cursor is null or id>p_cursor) order by id limit 100) s;
 return result;
end $$;

create or replace function public.bloom_calendar_sources(p_actor uuid,p_cursor uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 perform private.calendar_actor(p_actor,true);
 return (select jsonb_build_object('items',coalesce(jsonb_agg(private.calendar_health(id) order by id) filter(where rn<=100),'[]'),'nextCursor',case when count(*)>100 then (array_agg(id order by id))[100] else null end)
 from (select id,row_number() over(order by id) rn from public.calendar_sources where exists(select 1 from public.properties p where p.id=calendar_sources.property_id and p.deleted_at is null) and (p_cursor is null or id>p_cursor) order by id limit 101) page);end $$;

commit;
