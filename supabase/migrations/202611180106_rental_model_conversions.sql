begin;
-- Entire unit <-> room model conversions.
-- A property row stays the bookable listing (calendar, reservations, channel links, access, parking).
-- A house is the physical place whose rooms are rented separately. Plain entire units keep house_id null.
-- Split keeps the original listing as one of the rooms; merge keeps one room as the unit and archives
-- the others. Archived listings are read-only history: never deleted, never booked, never synced.

-- Narrow private helper for in-place definition patches; dropped at the end of this migration.
create function private.patch_104(p_sig text,p_old text,p_new text) returns void language plpgsql set search_path='' as $$
declare def text;begin
 def:=pg_get_functiondef(p_sig::regprocedure);
 if position(p_old in def)=0 then raise exception 'patch target missing in %',p_sig;end if;
 execute replace(def,p_old,p_new);
end$$;

-- 1. State --------------------------------------------------------------------------------------
alter table public.houses add column archived_at timestamptz;
alter table public.properties
 add column archived_at timestamptz,
 add column former_house_id uuid references public.houses,
 add column channel_check_required boolean not null default false,
 add column unit_cleaning_config jsonb,
 add constraint archived_inactive check(archived_at is null or (not active and draft_data is null));
grant select(archived_at,channel_check_required) on public.properties to authenticated;
-- Archived rooms keep their identifiers and Airbnb URLs as history without blocking reuse.
drop index public.house_room_identifier;
create unique index house_room_identifier on public.properties(house_id,lower(room_identifier)) where listing_type='room' and deleted_at is null and archived_at is null and room_identifier is not null;
drop index public.house_listing_source;
create unique index house_listing_source on public.properties(house_id,airbnb_listing_url) where house_id is not null and airbnb_listing_url is not null and deleted_at is null and archived_at is null;

-- 2. Conversion log and audit -------------------------------------------------------------------
create table private.listing_conversions(
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('split','merge')),
 state text not null check(state in ('pending','done','cancelled')),
 house_id uuid references public.houses,
 property_id uuid not null references public.properties, -- split: original listing; merge: surviving listing
 actor_id uuid not null references public.users,
 payload jsonb not null,
 scheduled_for timestamptz,
 before_snapshot jsonb not null,
 after_snapshot jsonb,
 attempts integer not null default 0,
 last_error text,
 created_at timestamptz not null default clock_timestamp(),
 executed_at timestamptz,
 cancelled_at timestamptz,
 cancelled_by uuid references public.users,
 check(state<>'pending' or scheduled_for is not null),
 check((state='done')=(executed_at is not null)),
 check((state='cancelled')=(cancelled_at is not null))
);
create unique index one_pending_conversion on private.listing_conversions(house_id) where state='pending';
create table private.listing_conversion_history(
 id uuid primary key default gen_random_uuid(),
 conversion_id uuid not null references private.listing_conversions,
 event text not null check(event in ('split','merge_scheduled','merged','postponed','failed','cancelled')),
 actor_id uuid references public.users, -- null when the scheduler acted
 before_snapshot jsonb,
 after_snapshot jsonb,
 detail jsonb not null default '{}',
 created_at timestamptz not null default clock_timestamp()
);
create trigger listing_conversion_history_immutable before update or delete on private.listing_conversion_history for each row execute function private.immutable();
alter table private.listing_conversions enable row level security;
alter table private.listing_conversion_history enable row level security;
revoke all on private.listing_conversions,private.listing_conversion_history from public,anon,authenticated,service_role;

-- Conversion functions are the only writers allowed to touch archived rows or move a job's listing.
create table private.conversion_context(txid bigint primary key);
alter table private.conversion_context enable row level security;
revoke all on private.conversion_context from public,anon,authenticated,service_role;
create function private.in_conversion() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.conversion_context where txid=txid_current())
$$;
create function private.conversion_begin() returns void language sql security definer set search_path='' as $$
 insert into private.conversion_context values(txid_current()) on conflict do nothing
$$;
create function private.conversion_end() returns void language sql security definer set search_path='' as $$
 delete from private.conversion_context where txid=txid_current()
$$;
create or replace function private.calendar_guard_identity() returns trigger language plpgsql set search_path='' as $$ begin
 if new.property_id is distinct from old.property_id and not (TG_TABLE_NAME='jobs' and private.in_conversion()) then perform private.calendar_error('CONFLICT');end if;
 if TG_TABLE_NAME='calendar_sources' and (to_jsonb(new)->'provider' is distinct from to_jsonb(old)->'provider' or to_jsonb(new)->'fingerprint' is distinct from to_jsonb(old)->'fingerprint') then perform private.calendar_error('CONFLICT');end if;
 return new;end $$;

create function private.rental_snapshot(p_house uuid,p_property uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'house',(select to_jsonb(h) from public.houses h where h.id=p_house),
 'pricing',(select to_jsonb(v) from public.house_visit_pricing v where v.house_id=p_house),
 'listings',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'listingType',p.listing_type,'houseId',p.house_id,
  'roomIdentifier',p.room_identifier,'roomLabel',p.room_label,'active',p.active,'draft',p.draft_data is not null,'archivedAt',p.archived_at,
  'enabledSources',(select coalesce(jsonb_agg(s.id order by s.id),'[]') from public.calendar_sources s where s.property_id=p.id and s.enabled),
  'owners',(select coalesce(jsonb_agg(o.owner_id order by o.owner_id),'[]') from public.property_owners o where o.property_id=p.id)) order by p.id),'[]')
  from public.properties p where p.deleted_at is null and (p.id=p_property or (p_house is not null and p.house_id=p_house))),
 'spaces',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.house_spaces s where s.house_id=p_house))
$$;

-- 3. Archived is readable history, never writable -----------------------------------------------
create or replace function private.people_access(p_property uuid,p_actor uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.properties p join public.users u on u.id=p_actor where p.id=p_property and p.deleted_at is null and (p.active or p.draft_data is not null or p.archived_at is not null)
 and (u.role='admin' or (u.role='owner' and exists(select 1 from public.property_owners po where po.property_id=p.id and po.owner_id=u.id))))
$$;
create function private.listing_writable(p_property uuid,p_actor uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.people_access(p_property,p_actor) and exists(select 1 from public.properties where id=p_property and archived_at is null)
$$;
do $patch$begin perform private.patch_104('public.bloom_property_access_info(uuid,jsonb)',$o$'canEdit',private.people_access(p_property,u.id))$o$,$n$'canEdit',private.listing_writable(p_property,u.id))$n$);end$patch$;

create function private.archived_listing_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare pid uuid;n jsonb;begin
 if private.in_conversion() then return coalesce(new,old);end if;
 n:=to_jsonb(new); -- generic row access: guarded tables have different columns
 if TG_TABLE_NAME='properties' then
  if (to_jsonb(old)->>'archived_at') is not null or (n->>'archived_at') is not null then raise exception 'CONFLICT';end if;return new;
 end if;
 if TG_TABLE_NAME in ('calendar_sources','calendar_exports') and not (n->>'enabled')::boolean then return new;end if;
 if TG_TABLE_NAME='jobs' and TG_OP='UPDATE' and not (n->>'status'='open' and to_jsonb(old)->>'status'<>'open') then return new;end if;
 pid:=(n->>'property_id')::uuid;
 if exists(select 1 from public.properties where id=pid and archived_at is not null) then raise exception 'CONFLICT';end if;
 return new;
end$$;
create trigger archived_listing_guard before update on public.properties for each row execute function private.archived_listing_guard();
create trigger archived_listing_guard before insert or update on public.property_entry_instructions for each row execute function private.archived_listing_guard();
create trigger archived_listing_guard before insert or update on public.calendar_sources for each row execute function private.archived_listing_guard();
create trigger archived_listing_guard before insert or update on public.jobs for each row execute function private.archived_listing_guard();
create trigger archived_listing_guard before insert on public.property_owners for each row execute function private.archived_listing_guard();
create trigger archived_listing_guard before insert on private.pending_property_owners for each row execute function private.archived_listing_guard();
create trigger archived_listing_guard before insert or update on private.property_cleaner_members for each row execute function private.archived_listing_guard();
create trigger archived_listing_guard before insert on private.property_invitations for each row execute function private.archived_listing_guard();
create trigger archived_listing_guard before insert or update on private.manual_bookings for each row execute function private.archived_listing_guard();
create trigger archived_listing_guard before insert or update on public.property_nightly_rates for each row execute function private.archived_listing_guard();
create trigger archived_listing_guard before insert or update on public.house_items for each row execute function private.archived_listing_guard();
create trigger archived_listing_guard before insert or update on private.calendar_exports for each row execute function private.archived_listing_guard();

-- 4. One iCal link / Airbnb listing per non-archived listing --------------------------------------
-- url_digest is an HMAC of the full link without the listing ID, so it identifies the same link
-- across listings (fingerprint includes the listing ID and cannot). Fires only when identity or
-- enablement changes, so routine sync bookkeeping on any pre-existing duplicate keeps working.
create function private.channel_unique_guard() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if TG_TABLE_NAME='calendar_sources' then
  if not new.enabled or new.url_digest is null then return new;end if;
  perform pg_advisory_xact_lock(hashtextextended('calendar-link:'||new.url_digest,0));
  if exists(select 1 from public.calendar_sources s join public.properties p on p.id=s.property_id where s.url_digest=new.url_digest and s.property_id<>new.property_id and s.enabled and p.deleted_at is null and p.archived_at is null) then raise exception 'CONFLICT';end if;
 else
  if new.airbnb_listing_url is null or new.archived_at is not null or new.deleted_at is not null then return new;end if;
  perform pg_advisory_xact_lock(hashtextextended('airbnb-listing:'||lower(new.airbnb_listing_url),0));
  if exists(select 1 from public.properties p where lower(p.airbnb_listing_url)=lower(new.airbnb_listing_url) and p.id<>new.id and p.deleted_at is null and p.archived_at is null) then raise exception 'CONFLICT';end if;
 end if;
 return new;end$$;
create trigger channel_unique_guard before insert or update of enabled,url_digest,property_id on public.calendar_sources for each row execute function private.channel_unique_guard();
create trigger channel_unique_guard before insert or update of airbnb_listing_url on public.properties for each row execute function private.channel_unique_guard();
do $$declare links integer;urls integer;begin
 select count(*) into links from (select url_digest from public.calendar_sources s join public.properties p on p.id=s.property_id where s.enabled and s.url_digest is not null and p.deleted_at is null group by url_digest having count(distinct s.property_id)>1)x;
 select count(*) into urls from (select lower(airbnb_listing_url) from public.properties where airbnb_listing_url is not null and deleted_at is null group by 1 having count(*)>1)x;
 if links+urls>0 then raise notice 'Bloom 104: % shared iCal link(s) and % shared Airbnb URL(s) predate the uniqueness rule; new duplicates are rejected.',links,urls;end if;
end$$;

-- 5. Owners and private cleaning teams belong to the whole house ---------------------------------
-- Rows stay keyed by listing (all existing authorization and payout code reads them), but every
-- edit is mirrored to the house's other live listings so the house behaves as one unit.
create function private.house_siblings(p_property uuid) returns setof uuid language sql stable security definer set search_path='' as $$
 select s.id from public.properties p join public.properties s on s.house_id=p.house_id and s.id<>p.id
 where p.id=p_property and p.house_id is not null and s.deleted_at is null and s.archived_at is null
$$;
-- Mirroring can create a row before a caller inserts it (an owner adding a room to their own house).
-- For house listings an already-present owner or team member is a no-op instead of a duplicate-key error.
create function private.house_duplicate_skip() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if not exists(select 1 from public.properties where id=new.property_id and house_id is not null) then return new;end if;
 if TG_TABLE_NAME='property_owners' then
  if exists(select 1 from public.property_owners where property_id=new.property_id and owner_id=(to_jsonb(new)->>'owner_id')::uuid) then return null;end if;
 elsif exists(select 1 from private.property_cleaner_members where property_id=new.property_id and cleaner_id=(to_jsonb(new)->>'cleaner_id')::uuid) then return null;
 end if;
 return new;end$$;
create trigger aa_house_duplicate_skip before insert on public.property_owners for each row execute function private.house_duplicate_skip();
create trigger aa_house_duplicate_skip before insert on private.property_cleaner_members for each row execute function private.house_duplicate_skip();
create function private.house_owner_mirror() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if TG_OP='INSERT' then
  insert into public.property_owners(property_id,owner_id) select s,new.owner_id from private.house_siblings(new.property_id) s on conflict do nothing;
 else
  delete from public.property_owners where owner_id=old.owner_id and property_id in(select s.id from public.properties p join public.properties s on s.house_id=p.house_id and s.id<>p.id where p.id=old.property_id and p.house_id is not null and s.deleted_at is null);
 end if;return null;end$$;
create trigger zz_house_owner_mirror after insert or delete on public.property_owners for each row execute function private.house_owner_mirror();
create function private.house_pending_owner_mirror() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.claimed_by is null then
  insert into private.pending_property_owners(property_id,email,created_by) select s,new.email,new.created_by from private.house_siblings(new.property_id) s on conflict do nothing;
 end if;return null;end$$;
create trigger zz_house_pending_owner_mirror after insert on private.pending_property_owners for each row execute function private.house_pending_owner_mirror();
create function private.house_team_mirror() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if TG_OP='DELETE' then
  delete from private.property_cleaner_members where cleaner_id=old.cleaner_id and property_id in(select private.house_siblings(old.property_id));
  return null;end if;
 -- Explicit update then insert: the duplicate-skip trigger would swallow an ON CONFLICT DO UPDATE.
 update private.property_cleaner_members m set active=new.active,default_assigned=new.default_assigned,individual_amount_cents=new.individual_amount_cents
 where m.cleaner_id=new.cleaner_id and m.property_id in(select private.house_siblings(new.property_id))
  and (m.active,m.default_assigned,m.individual_amount_cents) is distinct from (new.active,new.default_assigned,new.individual_amount_cents);
 insert into private.property_cleaner_members(property_id,cleaner_id,active,default_assigned,individual_amount_cents,joined_at)
 select s,new.cleaner_id,new.active,new.default_assigned,new.individual_amount_cents,new.joined_at from private.house_siblings(new.property_id) s
 where not exists(select 1 from private.property_cleaner_members x where x.property_id=s and x.cleaner_id=new.cleaner_id) on conflict do nothing;
 return null;end$$;
create trigger zz_house_team_mirror after insert or update or delete on private.property_cleaner_members for each row execute function private.house_team_mirror();
-- Team settings live on the listing row; keep them identical across the house.
create function private.house_team_settings_mirror() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.house_id is null or new.archived_at is not null or new.deleted_at is not null then return null;end if;
 update public.properties s set cleaning_management=new.cleaning_management,bloom_approved=new.bloom_approved,bloom_request_status=new.bloom_request_status,
  private_capacity=new.private_capacity,private_total_cents=new.private_total_cents,private_payer_id=new.private_payer_id,bloom_host_charge_cents=new.bloom_host_charge_cents
 where s.id in(select private.house_siblings(new.id)) and (s.cleaning_management,s.bloom_approved,s.bloom_request_status,s.private_capacity,s.private_total_cents,s.private_payer_id,s.bloom_host_charge_cents)
  is distinct from (new.cleaning_management,new.bloom_approved,new.bloom_request_status,new.private_capacity,new.private_total_cents,new.private_payer_id,new.bloom_host_charge_cents);
 return null;end$$;
create trigger zz_house_team_settings_mirror after update of cleaning_management,bloom_approved,bloom_request_status,private_capacity,private_total_cents,private_payer_id,bloom_host_charge_cents on public.properties for each row execute function private.house_team_settings_mirror();
-- A listing joining a house (new room draft, split) inherits the house's owners, pending owner and team.
create function private.house_join() returns trigger language plpgsql security definer set search_path='' as $$
declare anchor public.properties;begin
 if new.house_id is null or new.archived_at is not null or new.deleted_at is not null or (TG_OP='UPDATE' and old.house_id is not distinct from new.house_id) then return null;end if;
 insert into public.property_owners(property_id,owner_id) select distinct new.id,o.owner_id from public.property_owners o where o.property_id in(select private.house_siblings(new.id)) on conflict do nothing;
 insert into private.pending_property_owners(property_id,email,created_by) select new.id,x.email,x.created_by from private.pending_property_owners x where x.property_id in(select private.house_siblings(new.id)) and x.claimed_by is null order by x.created_at limit 1 on conflict do nothing;
 insert into private.property_cleaner_members(property_id,cleaner_id,active,default_assigned,individual_amount_cents,joined_at)
 select distinct on (m.cleaner_id) new.id,m.cleaner_id,m.active,m.default_assigned,m.individual_amount_cents,m.joined_at from private.property_cleaner_members m where m.property_id in(select private.house_siblings(new.id)) order by m.cleaner_id,m.joined_at on conflict do nothing;
 select s.* into anchor from public.properties s where s.id in(select private.house_siblings(new.id)) order by s.active desc,s.created_at,s.id limit 1;
 if anchor.id is not null then
  update public.properties set cleaning_management=anchor.cleaning_management,bloom_approved=anchor.bloom_approved,bloom_request_status=anchor.bloom_request_status,private_capacity=anchor.private_capacity,private_total_cents=anchor.private_total_cents,private_payer_id=anchor.private_payer_id,bloom_host_charge_cents=anchor.bloom_host_charge_cents
  where id=new.id and (cleaning_management,bloom_approved,bloom_request_status,private_capacity,private_total_cents,private_payer_id,bloom_host_charge_cents) is distinct from (anchor.cleaning_management,anchor.bloom_approved,anchor.bloom_request_status,anchor.private_capacity,anchor.private_total_cents,anchor.private_payer_id,anchor.bloom_host_charge_cents);
 end if;
 return null;end$$;
create trigger zz_house_join after insert or update of house_id on public.properties for each row execute function private.house_join();
-- Existing houses: share owners and team members across their live listings.
insert into public.property_owners(property_id,owner_id)
select distinct s.id,o.owner_id from public.property_owners o join public.properties p on p.id=o.property_id join public.properties s on s.house_id=p.house_id
where p.house_id is not null and p.deleted_at is null and s.deleted_at is null on conflict do nothing;
insert into private.property_cleaner_members(property_id,cleaner_id,active,default_assigned,individual_amount_cents,joined_at)
select distinct on (s.id,m.cleaner_id) s.id,m.cleaner_id,m.active,m.default_assigned,m.individual_amount_cents,m.joined_at from private.property_cleaner_members m join public.properties p on p.id=m.property_id join public.properties s on s.house_id=p.house_id
where p.house_id is not null and p.deleted_at is null and s.deleted_at is null order by s.id,m.cleaner_id,m.joined_at on conflict do nothing;

-- 6. Room activation: at least one shared space (was exactly bathroom + kitchen + living room) -----
do $patch$begin perform private.patch_104('public.bloom_listing_drafts(uuid,text,jsonb,integer,text)',
 $o$or (select count(distinct kind) from public.house_spaces where house_id=p.house_id and property_id is null and kind in ('bathroom','kitchen','living_room'))<>3$o$,
 $n$or not exists(select 1 from public.house_spaces where house_id=p.house_id and property_id is null)$n$);end$patch$;

-- 7. Computed status ------------------------------------------------------------------------------
create function private.listing_status(p public.properties) returns text language sql stable security definer set search_path='' as $$
 select case when p.deleted_at is not null then 'deleted' when p.archived_at is not null then 'archived' when p.draft_data is not null then 'draft'
 when not p.active then 'inactive' when not exists(select 1 from public.calendar_sources s where s.property_id=p.id and s.enabled) then 'needs_channel_link' else 'active' end
$$;

-- 8. Shared helpers -------------------------------------------------------------------------------
create function private.valid_access_info(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare item jsonb;begin
 if jsonb_typeof(p) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p) k where k not in ('entryType','code','entryNotes','parking','garageCode','parkingNotes')) then return false;end if;
 if p->>'entryType' is null or p->>'entryType' not in ('keypad','key','lockbox','other') or jsonb_typeof(p->'parking') is distinct from 'array' or jsonb_array_length(p->'parking')>4 then return false;end if;
 for item in select value from jsonb_array_elements(p->'parking') loop if jsonb_typeof(item)<>'string' or item#>>'{}' not in ('free_street','paid_street','driveway','garage') then return false;end if;end loop;
 if (select count(distinct value) from jsonb_array_elements(p->'parking'))<>jsonb_array_length(p->'parking') then return false;end if;
 return not exists(select 1 from unnest(array['code','entryNotes','garageCode','parkingNotes']) k where jsonb_typeof(p->k) is distinct from 'string' or length(p->>k)>2000);
end$$;
create function private.has_entry(p_property uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.property_entry_instructions where property_id=p_property and (length(trim(coalesce(access_info->>'code','')))>0 or length(trim(coalesce(access_info->>'entryNotes','')))>0))
$$;
-- Same configuration bloom_room_spaces writes: this room's bedroom plus the house's shared spaces.
create function private.room_config_refresh(p_property uuid) returns void language sql security definer set search_path='' as $$
 update public.properties p set cleaning_config=jsonb_build_object('version',coalesce((p.cleaning_config->>'version')::integer,0)+1,'supplies','[]'::jsonb,'rooms',
  (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'label',s.label,'type',case s.kind when 'bedroom' then 'bedrooms' when 'bathroom' then 'bathrooms' else s.kind end,'requiredPhoto',true) order by s.property_id nulls last,s.kind,s.id),'[]')
   from public.house_spaces s where s.house_id=p.house_id and (s.property_id is null or s.property_id=p.id) and s.kind in ('bedroom','bathroom','kitchen','living_room'))),
  bedroom_count=1,bathroom_count=(select count(*) from public.house_spaces s where s.house_id=p.house_id and s.kind='bathroom' and (s.property_id is null or s.property_id=p.id))
 where p.id=p_property
$$;
create function private.ensure_bedroom(p_house uuid,p_property uuid,p_label text) returns void language plpgsql security definer set search_path='' as $$
declare sid uuid;lbl text:=p_label;begin
 select id into sid from public.house_spaces where house_id=p_house and property_id=p_property and kind='bedroom' order by id limit 1;
 if exists(select 1 from public.house_spaces where house_id=p_house and label=lbl and id is distinct from sid) then lbl:=p_label||' · '||left(p_property::text,8);end if;
 if sid is null then insert into public.house_spaces(house_id,property_id,kind,label) values(p_house,p_property,'bedroom',lbl);
 else update public.house_spaces set label=lbl,revision=revision+1 where id=sid and label<>lbl;end if;
end$$;
-- Last day a merge must wait for: upcoming or in-progress stays, open visits that include another
-- room, and claimed or started visits anywhere in the house. Null means the merge can run now.
create function private.merge_blocking_date(p_house uuid,p_survivor uuid) returns date language sql stable security definer set search_path='' as $$
 with today as (select (clock_timestamp() at time zone h.timezone)::date d from public.houses h where h.id=p_house)
 select max(d) from (
  select e.end_local_date d from public.calendar_events e join public.calendar_sources s on s.id=e.source_id join public.properties p on p.id=s.property_id,today
  where p.house_id=p_house and p.id<>p_survivor and p.archived_at is null and p.deleted_at is null and s.enabled and e.source_status='active' and e.event_status<>'cancelled' and e.kind='reservation' and e.end_local_date>=today.d
  union all
  select mb.checkout from private.manual_bookings mb join public.properties p on p.id=mb.property_id,today
  where p.house_id=p_house and p.id<>p_survivor and p.archived_at is null and p.deleted_at is null and mb.status='active' and mb.checkout>=today.d
  union all
  select t.checkout_date from private.room_turnovers t join public.jobs j on j.id=t.job_id,today
  where t.house_id=p_house and t.property_id<>p_survivor and t.state<>'cancelled' and j.status='open' and t.checkout_date>=today.d
  union all
  select j.checkout_date from public.jobs j,today
  where j.house_id=p_house and j.status='open' and j.checkout_date>=today.d and (j.started_at is not null or exists(select 1 from public.assignments a where a.job_id=j.id and a.ended_at is null))
 ) x
$$;
create function private.end_of_day(p_day date,p_tz text) returns timestamptz language sql immutable set search_path='' as $$select ((p_day+1)::timestamp) at time zone p_tz$$;

-- 9. Split --------------------------------------------------------------------------------------
-- p_data: {rooms:[{name,identifier,label?,nightlyRateCents?,access?:object|'copy'}], keep:int,
--          shared:[{kind,label}], pricing:{firstHostCents,additionalHostCents,firstPoolCents,additionalPoolCents}?, houseName?}
create function private.split_listing(u public.users,p_property uuid,p_data jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.properties;h public.houses;room jsonb;n integer;keep integer;i integer;rid uuid;ids uuid[]:='{}';live boolean;draft boolean;acc jsonb;
 j public.jobs;t private.room_turnovers;ev uuid;b jsonb;today date;pr public.house_visit_pricing;before jsonb;cid uuid;pin jsonb;base_instructions text;moved integer:=0;
begin
 select * into p from public.properties where id=p_property for update;
 if p.id is null or p.deleted_at is not null or not private.listing_writable(p.id,u.id) then raise exception 'NOT_FOUND';end if;
 if p.listing_type<>'entire_home' or p.house_id is not null then raise exception 'CONFLICT';end if;
 -- Validate the whole request before touching anything.
 if jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('rooms','keep','shared','pricing','houseName'))
  or jsonb_typeof(p_data->'rooms') is distinct from 'array' or jsonb_typeof(p_data->'keep') is distinct from 'number' then raise exception 'VALIDATION_ERROR';end if;
 n:=jsonb_array_length(p_data->'rooms');keep:=(p_data->>'keep')::numeric::integer;
 if n not between 2 and 6 or keep not between 0 and n-1 or (p_data->>'keep')::numeric<>keep then raise exception 'VALIDATION_ERROR';end if;
 for room in select value from jsonb_array_elements(p_data->'rooms') loop
  if jsonb_typeof(room) is distinct from 'object' or exists(select 1 from jsonb_object_keys(room) k where k not in ('name','identifier','label','nightlyRateCents','access'))
   or jsonb_typeof(room->'name') is distinct from 'string' or length(trim(room->>'name')) not between 1 and 200
   or jsonb_typeof(room->'identifier') is distinct from 'string' or length(trim(room->>'identifier')) not between 1 and 100
   or (room ? 'label' and room->'label'<>'null'::jsonb and (jsonb_typeof(room->'label')<>'string' or length(room->>'label')>100))
   or (room ? 'nightlyRateCents' and room->'nightlyRateCents'<>'null'::jsonb and (jsonb_typeof(room->'nightlyRateCents')<>'number' or (room->>'nightlyRateCents')::numeric not between 0 and 100000000 or (room->>'nightlyRateCents')::numeric<>trunc((room->>'nightlyRateCents')::numeric)))
   or (room ? 'access' and room->'access'<>'null'::jsonb and room->'access'<>'"copy"'::jsonb and not private.valid_access_info(room->'access')) then raise exception 'VALIDATION_ERROR';end if;
 end loop;
 if (select count(distinct lower(trim(value->>'identifier'))) from jsonb_array_elements(p_data->'rooms'))<>n then raise exception 'VALIDATION_ERROR';end if;
 if p_data ? 'shared' and (jsonb_typeof(p_data->'shared')<>'array' or jsonb_array_length(p_data->'shared')>20 or exists(select 1 from jsonb_array_elements(p_data->'shared') s where jsonb_typeof(s)<>'object'
  or s->>'kind' is null or s->>'kind' not in ('bathroom','kitchen','living_room','house_laundry','outdoor') or jsonb_typeof(s->'label')<>'string' or length(trim(s->>'label')) not between 1 and 100)) then raise exception 'VALIDATION_ERROR';end if;
 if p_data ? 'houseName' and (jsonb_typeof(p_data->'houseName')<>'string' or length(trim(p_data->>'houseName')) not between 1 and 200) then raise exception 'VALIDATION_ERROR';end if;
 if p_data ? 'pricing' and p_data->'pricing'<>'null'::jsonb then
  pin:=p_data->'pricing';
  if jsonb_typeof(pin)<>'object' or exists(select 1 from jsonb_object_keys(pin) k where k not in ('firstHostCents','additionalHostCents','firstPoolCents','additionalPoolCents'))
   or exists(select 1 from unnest(array['firstHostCents','additionalHostCents','firstPoolCents','additionalPoolCents']) k where jsonb_typeof(pin->k) is distinct from 'number' or (pin->>k)::numeric<>trunc((pin->>k)::numeric) or (pin->>k)::numeric not between 0 and 100000000)
   or (pin->>'firstHostCents')::integer<1 or (pin->>'firstPoolCents')::integer<2 or (pin->>'firstPoolCents')::integer%2<>0 or (pin->>'additionalPoolCents')::integer%2<>0 then raise exception 'VALIDATION_ERROR';end if;
 end if;
 -- Claimed or started future whole-unit cleanings must be resolved by an admin first.
 today:=(clock_timestamp() at time zone p.timezone)::date;
 perform 1 from public.calendar_sources where property_id=p.id order by id for update;
 perform 1 from public.jobs where property_id=p.id and house_id is null and status='open' order by id for update;
 if exists(select 1 from public.jobs x where x.property_id=p.id and x.house_id is null and x.status='open' and x.checkout_date>=today and (x.started_at is not null or exists(select 1 from public.assignments a where a.job_id=x.id and a.ended_at is null))) then raise exception 'CONFLICT';end if;
 -- Reuse the house from an earlier merge, otherwise create one at the unit's address.
 if p.former_house_id is not null then
  select * into h from public.houses where id=p.former_house_id for update;
  if exists(select 1 from public.properties where house_id=h.id and deleted_at is null and archived_at is null) then raise exception 'CONFLICT';end if;
  update public.houses set archived_at=null,name=coalesce(nullif(trim(p_data->>'houseName'),''),name),address=p.address,timezone=p.timezone where id=h.id returning * into h;
 else
  insert into public.houses(name,address,timezone,created_by) values(coalesce(nullif(trim(p_data->>'houseName'),''),p.name),p.address,p.timezone,u.id) returning * into h;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('house-visit:'||h.id,0));
 if exists(select 1 from private.listing_conversions where house_id=h.id and state='pending') then raise exception 'CONFLICT';end if;
 before:=private.rental_snapshot(h.id,p.id);
 perform private.conversion_begin();
 -- Cleaning prices: first room + add-on per extra room. Required before any room can go live.
 select * into pr from public.house_visit_pricing where house_id=h.id for update;
 if p_data ? 'pricing' and p_data->'pricing'<>'null'::jsonb then
  insert into public.house_visit_pricing(house_id,first_host_cents,additional_host_cents,first_pool_cents,additional_pool_cents,revision)
  values(h.id,(pin->>'firstHostCents')::integer,(pin->>'additionalHostCents')::integer,(pin->>'firstPoolCents')::integer,(pin->>'additionalPoolCents')::integer,0)
  on conflict(house_id) do update set first_host_cents=excluded.first_host_cents,additional_host_cents=excluded.additional_host_cents,first_pool_cents=excluded.first_pool_cents,additional_pool_cents=excluded.additional_pool_cents,revision=public.house_visit_pricing.revision+1;
  insert into private.house_pricing_history(house_id,actor_id,before_snapshot,after_snapshot) select h.id,u.id,coalesce(to_jsonb(pr),'{}'),to_jsonb(v) from public.house_visit_pricing v where v.house_id=h.id;
 elsif pr.house_id is null and p.active then raise exception 'REVIEW_REQUIRED'; -- the live room keeps its calendar, so it needs prices now
 end if;
 -- Shared spaces (Backyard is stored as kind outdoor).
 insert into public.house_spaces(house_id,kind,label) select h.id,s->>'kind',trim(s->>'label') from jsonb_array_elements(coalesce(p_data->'shared','[]')) s on conflict(house_id,label) do nothing;
 if not exists(select 1 from public.house_spaces where house_id=h.id and property_id is null) then raise exception 'VALIDATION_ERROR';end if;
 -- The original listing becomes the kept room: same ID, calendar, reservations, jobs and owners.
 room:=p_data->'rooms'->keep;draft:=p.draft_data is not null;
 update public.properties set unit_cleaning_config=jsonb_build_object('config',cleaning_config,'bedrooms',bedroom_count,'bathrooms',bathroom_count),
  listing_type='room',house_id=h.id,former_house_id=null,name=trim(room->>'name'),room_identifier=trim(room->>'identifier'),room_label=nullif(trim(coalesce(room->>'label','')),''),
  channel_check_required=exists(select 1 from public.calendar_sources where property_id=p.id and enabled),
  draft_data=case when draft then coalesce(draft_data,'{}')||jsonb_build_object('name',trim(room->>'name'),'identifier',trim(room->>'identifier')) end,updated_at=clock_timestamp()
 where id=p.id;
 perform private.ensure_bedroom(h.id,p.id,trim(room->>'name'));
 if jsonb_typeof(room->'access')='object' then
  insert into public.property_entry_instructions(property_id,instructions,access_info) values(p.id,'',(room->'access')||jsonb_build_object('version',1))
  on conflict(property_id) do update set access_info=excluded.access_info||jsonb_build_object('version',coalesce((public.property_entry_instructions.access_info->>'version')::integer,0)+1);
 end if;
 if (room->>'nightlyRateCents') is not null then insert into public.property_nightly_rates(property_id,cents) values(p.id,(room->>'nightlyRateCents')::integer) on conflict(property_id) do update set cents=excluded.cents,updated_at=clock_timestamp();end if;
 ids:=array[p.id];
 select instructions into base_instructions from public.property_entry_instructions where property_id=p.id;
 -- New rooms start with empty calendars. Live only with an entry code or notes; otherwise a draft.
 for i in 0..n-1 loop
  if i=keep then continue;end if;
  room:=p_data->'rooms'->i;
  acc:=case when room->'access'='"copy"'::jsonb then (select access_info-'version' from public.property_entry_instructions where property_id=p.id) when jsonb_typeof(room->'access')='object' then room->'access' end;
  live:=not draft and acc is not null and (length(trim(coalesce(acc->>'code','')))>0 or length(trim(coalesce(acc->>'entryNotes','')))>0);
  insert into public.properties(city_id,name,timezone,address,is_bloom_owned,solo_rate_cents,owner_created,default_checkin_time,default_checkout_time,cleaning_start_time,cleaning_end_time,
   house_id,listing_type,room_identifier,room_label,active,draft_data)
  values(p.city_id,trim(room->>'name'),h.timezone,h.address,p.is_bloom_owned,p.solo_rate_cents,p.owner_created,p.default_checkin_time,p.default_checkout_time,p.cleaning_start_time,p.cleaning_end_time,
   h.id,'room',trim(room->>'identifier'),nullif(trim(coalesce(room->>'label','')),''),live,case when not live then jsonb_build_object('name',trim(room->>'name'),'identifier',trim(room->>'identifier')) end)
  returning id into rid;
  update public.properties set cleaner_pricing_set=p.cleaner_pricing_set,cleaning_management=p.cleaning_management,bloom_approved=p.bloom_approved,bloom_request_status=p.bloom_request_status,
   private_capacity=p.private_capacity,private_total_cents=p.private_total_cents,private_payer_id=p.private_payer_id,bloom_host_charge_cents=p.bloom_host_charge_cents where id=rid;
  insert into public.property_entry_instructions(property_id,instructions,access_info) values(rid,coalesce(base_instructions,''),coalesce(acc,'{"entryType":"other","code":"","entryNotes":"","parking":[],"garageCode":"","parkingNotes":""}'::jsonb)||jsonb_build_object('version',1));
  if (room->>'nightlyRateCents') is not null then insert into public.property_nightly_rates(property_id,cents) values(rid,(room->>'nightlyRateCents')::integer);end if;
  perform private.ensure_bedroom(h.id,rid,trim(room->>'name'));
  ids:=ids||rid;
 end loop;
 for i in 1..array_length(ids,1) loop perform private.room_config_refresh(ids[i]);end loop;
 -- Whole-unit maintenance items become shared house items.
 update public.house_items it set house_id=h.id,property_id=null where it.id in(
  select distinct on (x.kind,x.category,x.name) x.id from public.house_items x where x.house_id is null and x.property_id=p.id
  and not exists(select 1 from public.house_items y where y.house_id=h.id and y.property_id is null and y.kind=x.kind and y.category=x.category and y.name=x.name) order by x.kind,x.category,x.name,x.id);
 -- Unclaimed future whole-unit cleanings become grouped house visits in place (same job IDs).
 for j in select * from public.jobs where property_id=p.id and house_id is null and status='open' and checkout_date>=today order by checkout_date,id loop
  if exists(select 1 from public.jobs where house_id=h.id and checkout_date=j.checkout_date) then raise exception 'CONFLICT';end if;
  b:=private.job_snapshot(j.id);
  select je.event_id into ev from public.job_events je join public.calendar_events e on e.id=je.event_id where je.job_id=j.id order by (e.source_status='active') desc,e.updated_at desc,e.id limit 1;
  select * into t from private.room_turnovers where (ev is not null and event_id=ev) or (j.creation_origin='manual_booking' and booking_id=j.manual_booking_id) or (property_id=p.id and manual_key='job:'||j.id) order by id limit 1 for update;
  update public.jobs set house_id=h.id,updated_at=clock_timestamp() where id=j.id;
  if t.id is null then
   insert into private.room_turnovers(property_id,house_id,job_id,event_id,booking_id,manual_key,checkout_date,start_at,end_at,included,state,instructions)
   values(p.id,h.id,j.id,ev,case when j.creation_origin='manual_booking' then j.manual_booking_id end,case when ev is null and j.creation_origin<>'manual_booking' then 'job:'||j.id end,j.checkout_date,j.start_at,j.end_at,true,'accepted',coalesce(nullif(j.job_instructions,''),base_instructions,''));
  else
   update private.room_turnovers set property_id=p.id,house_id=h.id,job_id=j.id,checkout_date=j.checkout_date,start_at=j.start_at,end_at=j.end_at,included=true,state='accepted',revision=revision+1 where id=t.id;
  end if;
  update public.jobs set scope_revision=scope_revision+1 where id=j.id;
  perform private.visit_refresh(j.id);
  perform private.audit(j.id,'listing_split',b,p_key,jsonb_build_object('reason','Unit split into rooms; this cleaning is now a house visit.'));
  moved:=moved+1;
 end loop;
 insert into private.listing_conversions(kind,state,house_id,property_id,actor_id,payload,before_snapshot,after_snapshot,executed_at)
 values('split','done',h.id,p.id,u.id,p_data,before,private.rental_snapshot(h.id,p.id),clock_timestamp()) returning id into cid;
 insert into private.listing_conversion_history(conversion_id,event,actor_id,before_snapshot,after_snapshot,detail)
 select cid,'split',u.id,before_snapshot,after_snapshot,jsonb_build_object('rooms',to_jsonb(ids),'visitsConverted',moved) from private.listing_conversions where id=cid;
 perform private.conversion_end();
 return jsonb_build_object('conversionId',cid,'houseId',h.id,'rooms',(select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'status',private.listing_status(x),'keepsCalendar',x.id=p.id) order by array_position(ids,x.id)) from public.properties x where x.id=any(ids)));
end$$;

-- 10. Merge ------------------------------------------------------------------------------------
create function private.merge_execute(p_conversion uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.listing_conversions;h public.houses;s public.properties;r public.properties;j public.jobs;b jsonb;blk date;tm timestamptz:=clock_timestamp();today date;cfg jsonb;stash jsonb;archived uuid[]:='{}';
begin
 select * into c from private.listing_conversions where id=p_conversion for update;
 if c.id is null or c.state<>'pending' then return null;end if;
 select * into h from public.houses where id=c.house_id for update;
 perform pg_advisory_xact_lock(hashtextextended('house-visit:'||h.id,0));
 perform 1 from public.properties where house_id=h.id order by id for update;
 select * into s from public.properties where id=c.property_id;
 if s.id is null or s.house_id is distinct from h.id or s.archived_at is not null or s.deleted_at is not null then raise exception 'CONFLICT';end if;
 blk:=private.merge_blocking_date(h.id,s.id);
 if blk is not null then
  if private.end_of_day(blk,h.timezone)>c.scheduled_for then
   update private.listing_conversions set scheduled_for=private.end_of_day(blk,h.timezone),attempts=attempts+1 where id=c.id;
   insert into private.listing_conversion_history(conversion_id,event,actor_id,detail) values(c.id,'postponed',p_actor,jsonb_build_object('lastCheckout',blk));
  end if;
  return jsonb_build_object('conversionId',c.id,'state','pending','lastCheckout',blk,'scheduledFor',private.end_of_day(blk,h.timezone));
 end if;
 perform private.conversion_begin();
 today:=(tm at time zone h.timezone)::date;
 -- Archive the other rooms: syncs stop, export links revoked, history kept.
 for r in select * from public.properties where house_id=h.id and id<>s.id and deleted_at is null and archived_at is null order by id loop
  perform 1 from public.calendar_sources where property_id=r.id order by id for update;
  update public.calendar_sync_runs set status='failed',error_code='SYNC_FAILED',completed_at=tm where status='running' and source_id in(select id from public.calendar_sources where property_id=r.id);
  update public.calendar_sources set enabled=false,sync_version=sync_version+1,active_run_id=null,lease_expires_at=null,updated_at=tm where property_id=r.id;
  update private.calendar_exports set enabled=false,updated_at=tm where property_id=r.id;
  delete from private.pending_property_owners where property_id=r.id and claimed_by is null;
  update public.house_spaces set label=label||' · archived '||left(r.id::text,8),revision=revision+1 where house_id=h.id and property_id=r.id and kind='bedroom';
  update public.properties set active=false,draft_data=null,archived_at=tm,updated_at=tm where id=r.id;
  archived:=archived||r.id;
 end loop;
 -- The survivor becomes the entire unit again, keeping its calendar, links, access and parking.
 stash:=s.unit_cleaning_config;
 cfg:=coalesce(stash->'config',jsonb_build_object('version',1,'supplies','[]'::jsonb,'rooms',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'label',x.label,'type',case x.kind when 'bedroom' then 'bedrooms' when 'bathroom' then 'bathrooms' else x.kind end,'requiredPhoto',true) order by x.property_id nulls last,x.kind,x.id),'[]') from public.house_spaces x where x.house_id=h.id and x.kind in ('bedroom','bathroom','kitchen','living_room'))));
 update public.properties set listing_type='entire_home',house_id=null,former_house_id=h.id,room_identifier=null,room_label=null,
  name=coalesce(nullif(trim(c.payload->>'name'),''),name),cleaning_config=cfg,unit_cleaning_config=null,
  bedroom_count=coalesce((stash->>'bedrooms')::integer,(select count(*) from public.house_spaces where house_id=h.id and kind='bedroom')::integer),
  bathroom_count=coalesce((stash->>'bathrooms')::integer,(select count(*) from public.house_spaces where house_id=h.id and kind='bathroom')::integer),
  channel_check_required=true,draft_data=case when draft_data is not null then draft_data||jsonb_build_object('name',coalesce(nullif(trim(c.payload->>'name'),''),name)) end,updated_at=tm
 where id=s.id returning * into s;
 if (c.payload->>'nightlyRateCents') is not null then insert into public.property_nightly_rates(property_id,cents) values(s.id,(c.payload->>'nightlyRateCents')::integer) on conflict(property_id) do update set cents=excluded.cents,updated_at=tm;end if;
 -- Its future unclaimed visits become whole-unit cleanings again, at its own rate.
 for j in select * from public.jobs where house_id=h.id and status='open' and checkout_date>=today order by checkout_date,id loop
  if exists(select 1 from public.jobs x where x.property_id=s.id and x.checkout_date=j.checkout_date and x.creation_origin='imported' and not x.manual_date_override and x.id<>j.id and j.creation_origin='imported' and not j.manual_date_override) then raise exception 'CONFLICT';end if;
  b:=private.job_snapshot(j.id);
  update private.room_turnovers set included=false,state='cancelled',revision=revision+1 where job_id=j.id and state<>'cancelled';
  update public.jobs set house_id=null,property_id=s.id,
   start_at=case when creation_origin='imported' and not manual_date_override then (checkout_date+time '11:00') at time zone timezone_snapshot else start_at end,
   end_at=case when creation_origin='imported' and not manual_date_override then (checkout_date+time '15:00') at time zone timezone_snapshot else end_at end,
   solo_rate_cents_snapshot=case when cleaning_management='bloom' then s.solo_rate_cents else solo_rate_cents_snapshot end,
   host_charge_cents_snapshot=case when cleaning_management='bloom' then s.bloom_host_charge_cents else host_charge_cents_snapshot end,
   cleaning_config=s.cleaning_config,setup_required=s.owner_created and s.cleaning_config is null,scope_revision=scope_revision+1,version=version+1,updated_at=tm
  where id=j.id;
  perform private.audit(j.id,'listing_merged',b,'merge:'||c.id,jsonb_build_object('reason','Rooms merged into one unit; this cleaning is a whole-unit cleaning again.'));
 end loop;
 -- Shared and survivor-only maintenance items follow the unit; shared supplies stay with the house.
 update public.house_items it set house_id=null,property_id=s.id where it.id in(
  select distinct on (x.kind,x.category,x.name) x.id from public.house_items x where x.house_id=h.id and x.kind='maintenance' and (x.property_id is null or x.property_id=s.id)
  and not exists(select 1 from public.house_items y where y.house_id is null and y.property_id=s.id and y.kind=x.kind and y.category=x.category and y.name=x.name) order by x.kind,x.category,x.name,(x.property_id is null),x.id);
 update public.houses set archived_at=tm where id=h.id;
 update private.listing_conversions set state='done',executed_at=tm,after_snapshot=private.rental_snapshot(h.id,s.id)||jsonb_build_object('archived',to_jsonb(archived)) where id=c.id returning * into c;
 insert into private.listing_conversion_history(conversion_id,event,actor_id,before_snapshot,after_snapshot,detail) values(c.id,'merged',p_actor,c.before_snapshot,c.after_snapshot,jsonb_build_object('archived',to_jsonb(archived)));
 perform private.conversion_end();
 return jsonb_build_object('conversionId',c.id,'state','done','listingId',s.id,'archived',to_jsonb(archived));
end$$;

create function private.merge_request(u public.users,p_property uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.properties;s public.properties;h public.houses;blk date;cid uuid;res jsonb;begin
 select * into p from public.properties where id=p_property;
 if p.id is null or p.deleted_at is not null or not private.listing_writable(p.id,u.id) or p.house_id is null then raise exception 'NOT_FOUND';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('survivorId','name','nightlyRateCents','when'))
  or p_data->>'when' is null or p_data->>'when' not in ('now','after_last_checkout') or jsonb_typeof(p_data->'survivorId') is distinct from 'string'
  or (p_data ? 'name' and (jsonb_typeof(p_data->'name')<>'string' or length(trim(p_data->>'name')) not between 1 and 200))
  or (p_data ? 'nightlyRateCents' and p_data->'nightlyRateCents'<>'null'::jsonb and (jsonb_typeof(p_data->'nightlyRateCents')<>'number' or (p_data->>'nightlyRateCents')::numeric not between 0 and 100000000 or (p_data->>'nightlyRateCents')::numeric<>trunc((p_data->>'nightlyRateCents')::numeric))) then raise exception 'VALIDATION_ERROR';end if;
 select * into h from public.houses where id=p.house_id for update;
 perform pg_advisory_xact_lock(hashtextextended('house-visit:'||h.id,0));
 select * into s from public.properties where id=(p_data->>'survivorId')::uuid and house_id=h.id and deleted_at is null and archived_at is null;
 if s.id is null then raise exception 'NOT_FOUND';end if;
 if exists(select 1 from private.listing_conversions where house_id=h.id and state='pending') then raise exception 'CONFLICT';end if;
 blk:=private.merge_blocking_date(h.id,s.id);
 if blk is not null and p_data->>'when'='now' then raise exception 'CONFLICT';end if;
 insert into private.listing_conversions(kind,state,house_id,property_id,actor_id,payload,scheduled_for,before_snapshot)
 values('merge','pending',h.id,s.id,u.id,p_data,case when blk is null then clock_timestamp() else private.end_of_day(blk,h.timezone) end,private.rental_snapshot(h.id,s.id)) returning id into cid;
 insert into private.listing_conversion_history(conversion_id,event,actor_id,detail) values(cid,'merge_scheduled',u.id,jsonb_build_object('lastCheckout',blk));
 if blk is null then res:=private.merge_execute(cid,u.id);return res;end if;
 return jsonb_build_object('conversionId',cid,'state','pending','lastCheckout',blk,'scheduledFor',private.end_of_day(blk,h.timezone));
end$$;

-- New bookings on rooms that will be archived push a pending merge back.
create function private.pending_merge_push() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.state<>'cancelled' then
  update private.listing_conversions c set scheduled_for=private.end_of_day(new.checkout_date,h.timezone)
  from public.houses h where h.id=c.house_id and c.house_id=new.house_id and c.state='pending' and c.property_id<>new.property_id and c.scheduled_for<private.end_of_day(new.checkout_date,h.timezone);
 end if;return null;end$$;
create trigger zz_pending_merge_push after insert or update of checkout_date,state on private.room_turnovers for each row execute function private.pending_merge_push();

-- Scheduler: runs due merges, each isolated so one failure cannot block the others.
create function private.run_due_conversions() returns integer language plpgsql security definer set search_path='' as $$
declare c record;n integer:=0;r jsonb;begin
 for c in select id from private.listing_conversions where state='pending' and scheduled_for<=clock_timestamp() order by scheduled_for,id loop
  begin
   r:=private.merge_execute(c.id,null);
   if r->>'state'='done' then n:=n+1;end if;
  exception when others then
   update private.listing_conversions set attempts=attempts+1,last_error=left(sqlerrm,200),scheduled_for=clock_timestamp()+interval '1 hour' where id=c.id;
   insert into private.listing_conversion_history(conversion_id,event,detail) values(c.id,'failed',jsonb_build_object('error',left(sqlerrm,200)));
  end;
 end loop;
 return n;
end$$;

-- 11. Public entry point ---------------------------------------------------------------------------
-- Admins and any owner of the listing. Actions: read, split, merge, cancel_merge, confirm_channel.
create function public.bloom_rental_model(p_property uuid,p_action text default 'read',p_data jsonb default null,p_key text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;p public.properties;h public.houses;r jsonb;c private.listing_conversions;input jsonb:=jsonb_build_object('property',p_property,'action',p_action,'data',p_data);begin
 u:=private.require_actor();if u.role not in ('owner','admin') then raise exception 'FORBIDDEN';end if;
 select * into p from public.properties where id=p_property;
 if p.id is null or not private.people_access(p.id,u.id) then raise exception 'NOT_FOUND';end if;
 if p_action='read' then
  select * into h from public.houses where id=coalesce(p.house_id,p.former_house_id);
  return jsonb_build_object(
   'listing',jsonb_build_object('id',p.id,'name',p.name,'listingType',p.listing_type,'status',private.listing_status(p),'houseId',p.house_id,'channelCheckRequired',p.channel_check_required,'archivedAt',p.archived_at,'canConvert',private.listing_writable(p.id,u.id)),
   'house',case when p.house_id is not null then jsonb_build_object('id',h.id,'name',h.name,'address',h.address,'timezone',h.timezone,
    'pricing',(select jsonb_build_object('firstHostCents',v.first_host_cents,'additionalHostCents',v.additional_host_cents,'firstPoolCents',v.first_pool_cents,'additionalPoolCents',v.additional_pool_cents,'revision',v.revision) from public.house_visit_pricing v where v.house_id=h.id),
    'sharedSpaces',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'kind',x.kind,'label',x.label) order by x.kind,x.label),'[]') from public.house_spaces x where x.house_id=h.id and x.property_id is null)) end,
   'rooms',case when p.house_id is not null then (select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'identifier',x.room_identifier,'label',x.room_label,'status',private.listing_status(x),
    'nightlyRateCents',(select cents from public.property_nightly_rates where property_id=x.id),'hasEntry',private.has_entry(x.id),
    'hasChannel',exists(select 1 from public.calendar_sources s where s.property_id=x.id and s.enabled),'channelCheckRequired',x.channel_check_required) order by lower(x.room_identifier),x.id),'[]')
    from public.properties x where x.house_id=p.house_id and x.deleted_at is null and x.archived_at is null) end,
   'pendingMerge',(select jsonb_build_object('id',m.id,'survivorId',m.property_id,'scheduledFor',greatest(m.scheduled_for,private.end_of_day(private.merge_blocking_date(m.house_id,m.property_id),h.timezone)),'createdAt',m.created_at,'lastError',m.last_error)
    from private.listing_conversions m where m.house_id=p.house_id and m.state='pending'),
   'splitDefaults',case when p.listing_type='entire_home' and p.house_id is null and p.archived_at is null then jsonb_build_object('reusesHouse',p.former_house_id is not null,
    'pricing',coalesce((select jsonb_build_object('firstHostCents',v.first_host_cents,'additionalHostCents',v.additional_host_cents,'firstPoolCents',v.first_pool_cents,'additionalPoolCents',v.additional_pool_cents) from public.house_visit_pricing v where v.house_id=p.former_house_id),
     jsonb_build_object('firstHostCents',p.bloom_host_charge_cents,'additionalHostCents',null,'firstPoolCents',p.solo_rate_cents,'additionalPoolCents',null)),
    'sharedSpaces',(select coalesce(jsonb_agg(jsonb_build_object('kind',x.kind,'label',x.label) order by x.kind,x.label),'[]') from public.house_spaces x where x.house_id=p.former_house_id and x.property_id is null),
    'blockedByClaimedCleaning',exists(select 1 from public.jobs x where x.property_id=p.id and x.house_id is null and x.status='open' and x.checkout_date>=(clock_timestamp() at time zone p.timezone)::date and (x.started_at is not null or exists(select 1 from public.assignments a where a.job_id=x.id and a.ended_at is null)))) end,
   'mergePreview',case when p.house_id is not null then (select coalesce(jsonb_agg(jsonb_build_object('survivorId',x.id,'lastCheckout',private.merge_blocking_date(p.house_id,x.id)) order by lower(x.room_identifier),x.id),'[]') from public.properties x where x.house_id=p.house_id and x.deleted_at is null and x.archived_at is null) end);
 end if;
 if p_action not in ('split','merge','cancel_merge','confirm_channel') then raise exception 'VALIDATION_ERROR';end if;
 if not private.listing_writable(p.id,u.id) then raise exception 'NOT_FOUND';end if;
 r:=private.receipt('rental_model',p_key,input);if r is not null then return r;end if;
 if p_action='split' then r:=private.split_listing(u,p.id,p_data,p_key);
 elsif p_action='merge' then r:=private.merge_request(u,p.id,p_data);
 elsif p_action='cancel_merge' then
  select * into c from private.listing_conversions where house_id=p.house_id and state='pending' for update;
  if c.id is null then raise exception 'NOT_FOUND';end if;
  update private.listing_conversions set state='cancelled',scheduled_for=null,cancelled_at=clock_timestamp(),cancelled_by=u.id where id=c.id;
  insert into private.listing_conversion_history(conversion_id,event,actor_id) values(c.id,'cancelled',u.id);
  r:=jsonb_build_object('conversionId',c.id,'state','cancelled');
 else
  update public.properties set channel_check_required=false where id=p.id;
  r:=jsonb_build_object('id',p.id,'channelCheckRequired',false);
 end if;
 return private.save_receipt('rental_model',p_key,input,r);
end$$;
-- cancelled conversions clear scheduled_for, which the pending check allows.
revoke all on function public.bloom_rental_model(uuid,text,jsonb,text) from public,anon;
grant execute on function public.bloom_rental_model(uuid,text,jsonb,text) to authenticated;

-- 12. Listing reads carry the computed status ------------------------------------------------------
alter function public.bloom_owner_listings(uuid) rename to bloom_owner_listings_before_rental_model;
revoke all on function public.bloom_owner_listings_before_rental_model(uuid) from public,anon,authenticated,service_role;
create function public.bloom_owner_listings(p_cursor uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;begin
 r:=public.bloom_owner_listings_before_rental_model(p_cursor);
 return jsonb_set(r,'{items}',coalesce((select jsonb_agg(item||jsonb_build_object('isArchived',p.archived_at is not null,'archivedAt',p.archived_at,'status',private.listing_status(p),'channelCheckRequired',p.channel_check_required,
  'pendingMerge',(select jsonb_build_object('id',m.id,'survivorId',m.property_id,'scheduledFor',m.scheduled_for) from private.listing_conversions m where m.house_id=p.house_id and m.state='pending')) order by ordinal)
  from jsonb_array_elements(r->'items') with ordinality a(item,ordinal) join public.properties p on p.id=(item->>'id')::uuid),'[]'));
end$$;
revoke all on function public.bloom_owner_listings(uuid) from public,anon;
grant execute on function public.bloom_owner_listings(uuid) to authenticated;

revoke all on function private.patch_104(text,text,text),private.in_conversion(),private.conversion_begin(),private.conversion_end(),private.rental_snapshot(uuid,uuid),
 private.listing_writable(uuid,uuid),private.archived_listing_guard(),private.house_duplicate_skip(),private.channel_unique_guard(),private.house_siblings(uuid),private.house_owner_mirror(),private.house_pending_owner_mirror(),
 private.house_team_mirror(),private.house_team_settings_mirror(),private.house_join(),private.listing_status(public.properties),private.valid_access_info(jsonb),private.has_entry(uuid),
 private.room_config_refresh(uuid),private.ensure_bedroom(uuid,uuid,text),private.merge_blocking_date(uuid,uuid),private.end_of_day(date,text),
 private.split_listing(public.users,uuid,jsonb,text),private.merge_execute(uuid,uuid),private.merge_request(public.users,uuid,jsonb),private.pending_merge_push(),private.run_due_conversions()
 from public,anon,authenticated,service_role;
drop function private.patch_104(text,text,text);

-- 13. Scheduler (Supabase Cron, already enabled by 099 where available; absent in local test clusters).
do $$begin
 if exists(select 1 from pg_namespace where nspname='cron') then
  perform cron.schedule('bloom-listing-conversions','*/15 * * * *','select private.run_due_conversions()');
 end if;
end$$;
commit;
