begin;
-- One shared entry (main house door) per house; each room keeps its own entry in property_entry_instructions.
create table public.house_shared_entry (
 house_id uuid primary key references public.houses(id) on delete cascade,
 access_info jsonb not null,
 updated_at timestamptz not null default now()
);
alter table public.house_shared_entry enable row level security;
revoke all on public.house_shared_entry from public,anon,authenticated;

create function private.shared_entry_set(p_entry jsonb) returns boolean language sql immutable set search_path='' as $$
 select p_entry is not null and (length(trim(coalesce(p_entry->>'code','')))>0 or length(trim(coalesce(p_entry->>'entryNotes','')))>0)
$$;

-- A room counts as having entry details when either its own entry or its house's shared entry is filled in.
create or replace function private.has_entry(p_property uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.property_entry_instructions where property_id=p_property and (length(trim(coalesce(access_info->>'code','')))>0 or length(trim(coalesce(access_info->>'entryNotes','')))>0))
 or exists(select 1 from public.properties p join public.house_shared_entry s on s.house_id=p.house_id where p.id=p_property and p.listing_type='room' and private.shared_entry_set(s.access_info))
$$;

do $$declare def text;old text:='not exists(select 1 from public.property_entry_instructions where property_id=p.id and (length(trim(coalesce(access_info->>''code'','''')))>0 or length(trim(coalesce(access_info->>''entryNotes'','''')))>0))';begin
 def:=pg_get_functiondef('public.bloom_listing_drafts(uuid,text,jsonb,integer,text)'::regprocedure);
 if position(old in def)=0 then raise exception 'bloom_listing_drafts access gate not found';end if;
 execute replace(def,old,'not private.has_entry(p.id)');
 def:=pg_get_functiondef('public.bloom_room_setup(uuid,text,jsonb,text)'::regprocedure);
 old:='exists(select 1 from public.property_entry_instructions e where e.property_id=p.id and (length(trim(coalesce(e.access_info->>''code'','''')))>0 or length(trim(coalesce(e.access_info->>''entryNotes'','''')))>0))';
 if position(old in def)=0 then raise exception 'bloom_room_setup access check not found';end if;
 execute replace(def,old,'private.has_entry(p.id)');
end$$;

-- Access info for a room also returns its house's shared entry; anyone who may read the room's access may read it.
alter function public.bloom_property_access_info(uuid,jsonb) rename to bloom_property_access_info_before_shared;
revoke all on function public.bloom_property_access_info_before_shared(uuid,jsonb) from public,anon,authenticated;
create function public.bloom_property_access_info(p_property uuid,p_input jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;p public.properties;begin
 r:=public.bloom_property_access_info_before_shared(p_property,p_input);
 select * into p from public.properties where id=p_property;
 if p.listing_type<>'room' or p.house_id is null then return r;end if;
 return r||jsonb_build_object('shared',coalesce((select s.access_info||jsonb_build_object('version',coalesce((s.access_info->>'version')::integer,0)) from public.house_shared_entry s where s.house_id=p.house_id),
  '{"entryType":"other","code":"","entryNotes":"","version":0}'::jsonb));
end$$;
revoke all on function public.bloom_property_access_info(uuid,jsonb) from public,anon;
grant execute on function public.bloom_property_access_info(uuid,jsonb) to authenticated;

create function public.bloom_house_shared_entry(p_property uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;p public.properties;cur jsonb;begin
 u:=private.require_actor();
 select * into p from public.properties where id=p_property;
 if not found or not private.people_access(p_property,u.id) then raise exception 'NOT_FOUND';end if;
 if p.listing_type<>'room' or p.house_id is null then raise exception 'VALIDATION_ERROR';end if;
 if not private.listing_writable(p_property,u.id) then raise exception 'FORBIDDEN';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('entryType','code','entryNotes','version')) then raise exception 'VALIDATION_ERROR';end if;
 if p_input->>'entryType' is null or p_input->>'entryType' not in ('keypad','key','lockbox','other') or jsonb_typeof(p_input->'version') is distinct from 'number' then raise exception 'VALIDATION_ERROR';end if;
 if exists(select 1 from unnest(array['code','entryNotes']) k where jsonb_typeof(p_input->k) is distinct from 'string' or length(p_input->>k)>2000) then raise exception 'VALIDATION_ERROR';end if;
 perform 1 from public.houses where id=p.house_id for update;
 select access_info into cur from public.house_shared_entry where house_id=p.house_id;
 if (p_input->>'version')::integer is distinct from coalesce((cur->>'version')::integer,0) then raise exception 'CONFLICT';end if;
 insert into public.house_shared_entry(house_id,access_info) values(p.house_id,jsonb_build_object('entryType',p_input->>'entryType','code',p_input->>'code','entryNotes',p_input->>'entryNotes','version',coalesce((cur->>'version')::integer,0)+1))
 on conflict(house_id) do update set access_info=excluded.access_info,updated_at=now();
 return public.bloom_property_access_info(p_property,null);
end$$;
revoke all on function public.bloom_house_shared_entry(uuid,jsonb) from public,anon;
grant execute on function public.bloom_house_shared_entry(uuid,jsonb) to authenticated;
commit;
