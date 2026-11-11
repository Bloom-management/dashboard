begin;
-- properties remain the bookable listing/calendar identity; a house is physical.
create table public.houses (
 id uuid primary key default gen_random_uuid(), name text not null, address text not null,
 timezone text not null default 'America/Detroit', latitude double precision, longitude double precision,
 pin_confirmed_by uuid references public.users, pin_confirmed_at timestamptz,
 created_by uuid not null references public.users, created_at timestamptz not null default now(),
 check((latitude is null)=(longitude is null)),check(latitude between -90 and 90),check(longitude between -180 and 180),
 check((pin_confirmed_by is null)=(pin_confirmed_at is null))
);
alter table public.properties add column house_id uuid references public.houses,
 add column listing_type text not null default 'entire_home' check(listing_type in ('entire_home','room')),
 add column draft_data jsonb, add column draft_revision integer not null default 0,
 add column room_identifier text, add column room_label text,
 add constraint draft_inactive check(draft_data is null or not active),
 add constraint room_has_house check(listing_type<>'room' or house_id is not null);
create unique index house_room_identifier on public.properties(house_id,lower(room_identifier)) where listing_type='room' and deleted_at is null and room_identifier is not null;
create unique index house_listing_source on public.properties(house_id,airbnb_listing_url) where house_id is not null and airbnb_listing_url is not null and deleted_at is null;
create table public.house_spaces (
 id uuid primary key default gen_random_uuid(), house_id uuid not null references public.houses,
 property_id uuid references public.properties, kind text not null check(kind in ('bedroom','bathroom','kitchen','living_room','house_laundry','outdoor')),
 label text not null, unique(house_id,label)
);
create table public.listing_spaces(property_id uuid references public.properties, space_id uuid references public.house_spaces,primary key(property_id,space_id));
-- Definitions are not condition reports. NULL means Not reported, without a timestamp.
create table public.house_items (
 id uuid primary key default gen_random_uuid(),house_id uuid not null references public.houses,
 property_id uuid references public.properties,space_id uuid references public.house_spaces,
 kind text not null check(kind in ('supply','maintenance')),category text not null,name text not null,
 proposed boolean not null default true,active boolean not null default true,revision integer not null default 0,
 unique nulls not distinct(house_id,property_id,kind,category,name)
);
create table public.house_item_reports (
 id uuid primary key default gen_random_uuid(),item_id uuid not null references public.house_items,
 revision integer not null, value text not null,author_id uuid not null references public.users,
 reported_at timestamptz not null default clock_timestamp(),job_id uuid references public.jobs,
 unique(item_id,revision)
);
alter table public.houses enable row level security;
alter table public.house_spaces enable row level security;
alter table public.listing_spaces enable row level security;
alter table public.house_items enable row level security;
alter table public.house_item_reports enable row level security;
revoke all on public.houses,public.house_spaces,public.listing_spaces,public.house_items,public.house_item_reports from public,anon,authenticated;
create function private.house_manage(p_house uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_admin() or exists(select 1 from public.properties p join public.property_owners o on o.property_id=p.id where p.house_id=p_house and p.deleted_at is null and o.owner_id=(private.actor()).id)
$$;
-- Authoritative house address. Updating a room never changes a confirmed house.
create function private.room_house_address() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.house_id is not null then select address,timezone into new.address,new.timezone from public.houses where id=new.house_id;end if;
 return new;end $$;
create trigger room_house_address before insert or update of house_id,address,timezone on public.properties for each row execute function private.room_house_address();
-- Until grouped visit execution is enabled, room drafts cannot enter legacy one-property jobs.
create function private.draft_operational_guard() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if exists(select 1 from public.properties where id=new.property_id and (draft_data is not null or listing_type='room')) then raise exception 'REVIEW_REQUIRED';end if;
 return new;end $$;
create trigger draft_job_guard before insert or update of property_id on public.jobs for each row execute function private.draft_operational_guard();
create trigger draft_calendar_guard before insert or update of property_id on public.calendar_sources for each row execute function private.draft_operational_guard();
create function public.bloom_listing_drafts(p_id uuid default null,p_action text default 'list',p_data jsonb default null,p_revision integer default null,p_key text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.users;p public.properties;r jsonb;v_input jsonb:=jsonb_build_object('id',p_id,'action',p_action,'data',p_data,'revision',p_revision);begin
 u:=private.require_actor();if u.role not in ('owner','admin') then raise exception 'FORBIDDEN';end if;
 if p_action='list' then
 return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'houseId',x.house_id,'houseName',h.name,'address',x.address,'timezone',x.timezone,'listingType',x.listing_type,'identifier',x.room_identifier,'label',x.room_label,'listingUrl',x.airbnb_listing_url,'image',x.airbnb_cover_url,'thumbnailStatus',x.airbnb_cover_status,'data',x.draft_data,'revision',x.draft_revision) order by h.name,x.room_identifier,x.id)
 from public.properties x left join public.houses h on h.id=x.house_id where x.draft_data is not null and x.deleted_at is null and (p_id is null or x.id=p_id) and (u.role='admin' or exists(select 1 from public.property_owners o where o.property_id=x.id and o.owner_id=u.id))),'[]');end if;
 if p_action not in ('save','discard','activate') then raise exception 'VALIDATION_ERROR';end if;
 select * into p from public.properties where id=p_id for update;
 if p.id is null or not (u.role='admin' or exists(select 1 from public.property_owners where property_id=p.id and owner_id=u.id)) then raise exception 'NOT_FOUND';end if;
 r:=private.receipt('listing_draft',p_key,v_input);if r is not null then return r;end if;
 if p.deleted_at is not null or p.draft_data is null or p.draft_revision is distinct from p_revision then raise exception 'CONFLICT';end if;
 if p_action='discard' then update public.properties set deleted_at=clock_timestamp(),draft_revision=draft_revision+1 where id=p.id;
 elsif p_action='activate' then
 -- No unsafe fallback to the legacy independent room job model.
 if p.listing_type='room' then raise exception 'REVIEW_REQUIRED';end if;
 if length(trim(p.name))=0 or length(trim(p.address))=0 or p.cleaning_config is null or (coalesce(length(trim(p.draft_data->>'instructions')),0)=0 and not exists(select 1 from public.property_entry_instructions where property_id=p.id and length(trim(instructions))>0)) then raise exception 'VALIDATION_ERROR';end if;
 if coalesce(length(trim(p.draft_data->>'instructions')),0)>0 then insert into public.property_entry_instructions(property_id,instructions) values(p.id,p.draft_data->>'instructions') on conflict(property_id) do update set instructions=excluded.instructions,updated_at=clock_timestamp();end if;
 update public.properties set draft_data=null,active=true,draft_revision=draft_revision+1 where id=p.id;
 else
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>12000 or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('name','identifier','label','instructions','reviewSuggestions','address','timezone')) then raise exception 'VALIDATION_ERROR';end if;
 if exists(select 1 from jsonb_each(p_data) e where e.key<>'reviewSuggestions' and (jsonb_typeof(e.value)<>'string' or length(e.value#>>'{}')>5000)) then raise exception 'VALIDATION_ERROR';end if;
 if p_data ? 'timezone' and not exists(select 1 from pg_catalog.pg_timezone_names where name=p_data->>'timezone') then raise exception 'VALIDATION_ERROR';end if;
 update public.properties set address=coalesce(p_data->>'address',address),timezone=coalesce(p_data->>'timezone',timezone),name=coalesce(nullif(trim(p_data->>'name'),''),name),room_identifier=nullif(trim(p_data->>'identifier'),''),room_label=nullif(trim(p_data->>'label'),''),draft_data=p_data,draft_revision=draft_revision+1 where id=p.id;
 end if;
 r:=jsonb_build_object('id',p.id,'action',p_action,'revision',p_revision+1);
 return private.save_receipt('listing_draft',p_key,v_input,r);
end $$;
create function public.bloom_house_items(p_property uuid,p_item uuid default null,p_action text default 'list',p_value text default null,p_revision integer default null,p_job uuid default null,p_key text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.users;p public.properties;i public.house_items;r jsonb;v_input jsonb:=jsonb_build_object('property',p_property,'item',p_item,'action',p_action,'value',p_value,'revision',p_revision,'job',p_job);manager boolean;begin
 u:=private.require_actor();select * into p from public.properties where id=p_property and deleted_at is null;
 manager:=u.role='admin' or exists(select 1 from public.property_owners where property_id=p.id and owner_id=u.id);
 if p.id is null or p.house_id is null or not (manager or (p.draft_data is null and exists(select 1 from public.jobs j where j.id=p_job and j.property_id=p.id and j.status='open' and private.assigned(j.id)))) then raise exception 'NOT_FOUND';end if;
 if p_action='list' then
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.category,x.name) from (select t.id,t.kind,t.category,t.name,t.proposed,t.revision,case when t.property_id is null then 'shared' else 'room' end scope,(select value from public.house_item_reports where item_id=t.id order by revision desc limit 1) value,(select reported_at from public.house_item_reports where item_id=t.id order by revision desc limit 1) "reportedAt" from public.house_items t where t.house_id=p.house_id and t.active and (t.property_id is null or t.property_id=p.id))x),'[]');end if;
 select * into i from public.house_items where id=p_item and house_id=p.house_id and (property_id is null or property_id=p.id) for update;
 if i.id is null then raise exception 'NOT_FOUND';end if;
 r:=private.receipt('house_item',p_key,v_input);if r is not null then return r;end if;
 if i.revision is distinct from p_revision then raise exception 'CONFLICT';end if;
 if p_action='remove' and manager then update public.house_items set active=false,revision=revision+1 where id=i.id;
 elsif p_action='rename' and manager and length(trim(p_value)) between 1 and 200 then update public.house_items set name=trim(p_value),revision=revision+1 where id=i.id;
 elsif p_action='report' then
 if (i.kind='supply' and p_value not in ('full','moderate','low','empty','not_found')) or (i.kind='maintenance' and p_value not in ('good','issue')) or p_value is null then raise exception 'VALIDATION_ERROR';end if;
 update public.house_items set revision=revision+1 where id=i.id;
 insert into public.house_item_reports(item_id,revision,value,author_id,job_id) values(i.id,i.revision+1,p_value,u.id,p_job);
 else raise exception 'VALIDATION_ERROR';end if;
 return private.save_receipt('house_item',p_key,v_input,jsonb_build_object('id',i.id,'revision',i.revision+1));
end $$;
create table public.house_visit_pricing (
 house_id uuid primary key references public.houses,first_host_cents integer not null check(first_host_cents>0),
 additional_host_cents integer not null check(additional_host_cents>=0),first_pool_cents integer not null check(first_pool_cents>0 and first_pool_cents%2=0),additional_pool_cents integer not null check(additional_pool_cents>=0 and additional_pool_cents%2=0),revision integer not null default 0
);
alter table public.house_visit_pricing enable row level security;
revoke all on public.house_visit_pricing from public,anon,authenticated;

-- Add house context without changing existing owner authorization or pagination.
alter function public.bloom_owner_listings(uuid) rename to bloom_owner_listings_before_houses;
revoke all on function public.bloom_owner_listings_before_houses(uuid) from public,anon,authenticated,service_role;
create function public.bloom_owner_listings(p_cursor uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;begin
 r:=public.bloom_owner_listings_before_houses(p_cursor);
 return jsonb_set(r,'{items}',coalesce((select jsonb_agg(item||jsonb_build_object('isDraft',p.draft_data is not null,'houseId',p.house_id,'houseName',h.name,'listingType',p.listing_type,'roomIdentifier',p.room_identifier) order by ordinal) from jsonb_array_elements(r->'items') with ordinality a(item,ordinal) join public.properties p on p.id=(item->>'id')::uuid left join public.houses h on h.id=p.house_id),'[]'));
end $$;
revoke all on function private.house_manage(uuid),private.room_house_address(),private.draft_operational_guard() from public,anon,authenticated,service_role;
revoke all on function public.bloom_listing_drafts(uuid,text,jsonb,integer,text),public.bloom_house_items(uuid,uuid,text,text,integer,uuid,text),public.bloom_owner_listings(uuid) from public,anon;
grant execute on function public.bloom_listing_drafts(uuid,text,jsonb,integer,text),public.bloom_house_items(uuid,uuid,text,text,integer,uuid,text),public.bloom_owner_listings(uuid) to authenticated;
-- Keep drafts out of owner performance denominators, preserving original authorization.
alter function public.bloom_owner_analytics(date,date,uuid[]) rename to bloom_owner_analytics_before_drafts;
revoke all on function public.bloom_owner_analytics_before_drafts(date,date,uuid[]) from public,anon,authenticated,service_role;
create function public.bloom_owner_analytics(p_from date,p_to_exclusive date,p_properties uuid[] default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;begin
 r:=public.bloom_owner_analytics_before_drafts(p_from,p_to_exclusive,p_properties);
 return jsonb_set(r,'{properties}',coalesce((select jsonb_agg(x) from jsonb_array_elements(r->'properties') x join public.properties p on p.id=(x->>'id')::uuid where p.draft_data is null),'[]'));
end $$;
revoke all on function public.bloom_owner_analytics(date,date,uuid[]) from public,anon;
grant execute on function public.bloom_owner_analytics(date,date,uuid[]) to authenticated;
create function public.bloom_listing_draft_create(p_city uuid,p_type text,p_data jsonb,p_key text,p_house uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;r jsonb;pid uuid;hid uuid:=p_house;v_input jsonb:=jsonb_build_object('city',p_city,'type',p_type,'data',p_data,'house',p_house);begin
 u:=private.require_actor();if u.role not in ('owner','admin') then raise exception 'FORBIDDEN';end if;
 r:=private.receipt('listing_draft_create',p_key,v_input);if r is not null then return r;end if;
 if p_type not in ('room','entire_home') or p_type is null or not exists(select 1 from public.cities where id=p_city and active)
 or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>8000
 or exists(select 1 from jsonb_each(p_data) e where e.key not in ('name','address','timezone','identifier','label','instructions') or jsonb_typeof(e.value)<>'string' or length(e.value#>>'{}')>1000) then raise exception 'VALIDATION_ERROR';end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=coalesce(p_data->>'timezone','America/Detroit')) then raise exception 'VALIDATION_ERROR';end if;
 if hid is not null then
 if p_type<>'room' or not private.house_manage(hid) then raise exception 'NOT_FOUND';end if;
 elsif p_type='room' then
 insert into public.houses(name,address,timezone,created_by) values(coalesce(nullif(trim(p_data->>'address'),''),'House draft'),coalesce(p_data->>'address',''),coalesce(p_data->>'timezone','America/Detroit'),u.id) returning id into hid;
 end if;
 insert into public.properties(city_id,name,address,timezone,active,house_id,listing_type,room_identifier,room_label,draft_data,owner_created)
 values(p_city,coalesce(nullif(trim(p_data->>'name'),''),'Untitled listing'),coalesce(p_data->>'address',''),coalesce(p_data->>'timezone','America/Detroit'),false,hid,p_type,nullif(trim(p_data->>'identifier'),''),nullif(trim(p_data->>'label'),''),p_data,true) returning id into pid;
 if u.role='owner' then insert into public.property_owners(property_id,owner_id) values(pid,u.id);end if;
 return private.save_receipt('listing_draft_create',p_key,v_input,jsonb_build_object('id',pid));
end $$;
revoke all on function public.bloom_listing_draft_create(uuid,text,jsonb,text,uuid) from public,anon;
grant execute on function public.bloom_listing_draft_create(uuid,text,jsonb,text,uuid) to authenticated;

commit;
