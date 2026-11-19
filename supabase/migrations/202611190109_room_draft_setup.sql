-- Room draft setup: owners and admins can choose a house's shared spaces and create its cleaning prices
-- from a room draft, and every room gets its own bedroom space automatically. Before this, a house with
-- no pricing row or spaces (for example rooms created as drafts) could never be activated from the app.

create function public.bloom_room_setup(p_property uuid,p_action text default 'read',p_data jsonb default null,p_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;p public.properties;r jsonb;kinds text[];k text;lbl text;old_value jsonb;v public.house_visit_pricing;
 input jsonb:=jsonb_build_object('property',p_property,'action',p_action,'data',p_data);
 labels constant jsonb:='{"kitchen":"Kitchen","living_room":"Living room","bathroom":"Shared bathroom","house_laundry":"Laundry","outdoor":"Backyard"}';
begin
 u:=private.require_actor();
 select * into p from public.properties where id=p_property;
 if p.id is null or p.deleted_at is not null or p.listing_type is distinct from 'room' or p.house_id is null
  or u.role not in ('owner','admin') or not private.people_access(p.id,u.id) then raise exception 'NOT_FOUND';end if;
 if p_action not in ('read','shared','pricing') then raise exception 'VALIDATION_ERROR';end if;
 if p_action<>'read' then
  if not private.listing_writable(p.id,u.id) then raise exception 'CONFLICT';end if;
  perform 1 from public.houses where id=p.house_id for update;
  r:=private.receipt('room_setup',p_key,input);if r is not null then return r;end if;
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'VALIDATION_ERROR';end if;
  if p_action='shared' then
   if (select count(*) from jsonb_object_keys(p_data))<>1 or jsonb_typeof(p_data->'kinds') is distinct from 'array'
    or jsonb_array_length(p_data->'kinds') not between 1 and 5
    or exists(select 1 from jsonb_array_elements(p_data->'kinds') e where jsonb_typeof(e) is distinct from 'string' or not labels ? (e#>>'{}'))
   then raise exception 'VALIDATION_ERROR';end if;
   select array_agg(distinct e#>>'{}') into kinds from jsonb_array_elements(p_data->'kinds') e;
   -- A shared space already used by visits, listings or maintenance items stays.
   if exists(select 1 from public.house_spaces s where s.house_id=p.house_id and s.property_id is null and s.kind<>all(kinds)
    and (exists(select 1 from private.visit_space_completion c where c.space_id=s.id) or exists(select 1 from public.listing_spaces l where l.space_id=s.id)
     or exists(select 1 from public.house_items i where i.space_id=s.id))) then raise exception 'CONFLICT';end if;
   delete from public.house_spaces where house_id=p.house_id and property_id is null and kind<>all(kinds);
   foreach k in array kinds loop
    if not exists(select 1 from public.house_spaces where house_id=p.house_id and property_id is null and kind=k) then
     lbl:=labels->>k;
     if exists(select 1 from public.house_spaces where house_id=p.house_id and label=lbl) then lbl:=lbl||' (shared)';end if;
     insert into public.house_spaces(house_id,kind,label) values(p.house_id,k,lbl);
    end if;
   end loop;
  else
   if (select count(*) from jsonb_object_keys(p_data))<>4 or exists(select 1 from jsonb_each(p_data) e where e.key not in ('firstHostCents','additionalHostCents','firstPoolCents','additionalPoolCents') or jsonb_typeof(e.value) is distinct from 'number') then raise exception 'VALIDATION_ERROR';end if;
   if (p_data->>'firstHostCents')::numeric not between 1 and 100000000 or (p_data->>'additionalHostCents')::numeric not between 0 and 100000000
    or (p_data->>'firstPoolCents')::numeric not between 2 and 100000000 or (p_data->>'additionalPoolCents')::numeric not between 0 and 100000000
    or exists(select 1 from jsonb_each(p_data) e where (e.value#>>'{}')::numeric<>trunc((e.value#>>'{}')::numeric))
    or (p_data->>'firstPoolCents')::integer%2<>0 or (p_data->>'additionalPoolCents')::integer%2<>0 then raise exception 'VALIDATION_ERROR';end if;
   old_value:=(select to_jsonb(x) from public.house_visit_pricing x where x.house_id=p.house_id);
   insert into public.house_visit_pricing(house_id,first_host_cents,additional_host_cents,first_pool_cents,additional_pool_cents,revision)
   values(p.house_id,(p_data->>'firstHostCents')::integer,(p_data->>'additionalHostCents')::integer,(p_data->>'firstPoolCents')::integer,(p_data->>'additionalPoolCents')::integer,0)
   on conflict(house_id) do update set first_host_cents=excluded.first_host_cents,additional_host_cents=excluded.additional_host_cents,
    first_pool_cents=excluded.first_pool_cents,additional_pool_cents=excluded.additional_pool_cents,revision=public.house_visit_pricing.revision+1
   returning * into v;
   insert into private.house_pricing_history(house_id,actor_id,before_snapshot,after_snapshot) values(p.house_id,u.id,coalesce(old_value,'{}'::jsonb),to_jsonb(v));
  end if;
  perform private.ensure_bedroom(p.house_id,p.id,coalesce(nullif(trim(p.room_identifier),''),p.name)||' bedroom');
  perform private.room_config_refresh(x.id) from public.properties x where x.house_id=p.house_id and x.deleted_at is null and x.archived_at is null;
 end if;
 r:=jsonb_build_object(
  'sharedKinds',(select coalesce(jsonb_agg(distinct s.kind),'[]') from public.house_spaces s where s.house_id=p.house_id and s.property_id is null),
  'pricing',(select jsonb_build_object('firstHostCents',x.first_host_cents,'additionalHostCents',x.additional_host_cents,'firstPoolCents',x.first_pool_cents,'additionalPoolCents',x.additional_pool_cents) from public.house_visit_pricing x where x.house_id=p.house_id),
  'hasAccess',exists(select 1 from public.property_entry_instructions e where e.property_id=p.id and (length(trim(coalesce(e.access_info->>'code','')))>0 or length(trim(coalesce(e.access_info->>'entryNotes','')))>0)),
  'canEdit',private.listing_writable(p.id,u.id));
 if p_action<>'read' then return private.save_receipt('room_setup',p_key,input,r);end if;
 return r;
end$$;
revoke all on function public.bloom_room_setup(uuid,text,jsonb,text) from public,anon;
grant execute on function public.bloom_room_setup(uuid,text,jsonb,text) to authenticated;

-- Activation creates the room's bedroom space first, so owners never have to add it by hand.
do $$declare def text;old text:='if p.listing_type=''room'' and (p.room_identifier is null';begin
 def:=pg_get_functiondef('public.bloom_listing_drafts(uuid,text,jsonb,integer,text)'::regprocedure);
 if position(old in def)=0 then raise exception 'activation gate not found';end if;
 def:=replace(def,old,'if p.listing_type=''room'' and p.house_id is not null and p.room_identifier is not null then perform private.ensure_bedroom(p.house_id,p.id,trim(p.room_identifier)||'' bedroom'');perform private.room_config_refresh(p.id);select * into p from public.properties where id=p.id;end if;
 '||old);
 execute def;
end$$;

-- Calendar links on room drafts. A draft room may connect and sync its Airbnb/Vrbo calendars so its
-- bookings are in place, but no cleanings are created until it is published. The next sync after
-- activation attaches every stored booking that has no cleaning yet (room visits already do this
-- for unchanged events). Entire-home drafts keep the existing rule: calendars after publishing.
create function private.calendar_draft_room(p public.properties) returns boolean language sql stable set search_path='' as $$
 select p.draft_data is not null and p.listing_type='room' and p.house_id is not null and p.deleted_at is null and p.archived_at is null
$$;
revoke all on function private.calendar_draft_room(public.properties) from public,anon,authenticated;
-- Drafts still never get jobs; a room draft may now hold calendar sources.
do $$declare def text;old text:='if exists(select 1 from public.properties where id=new.property_id and draft_data is not null) then raise exception ''REVIEW_REQUIRED'';end if;';begin
 def:=pg_get_functiondef('private.draft_operational_guard()'::regprocedure);
 if position(old in def)=0 then raise exception 'draft guard not found';end if;
 execute replace(def,old,'if exists(select 1 from public.properties x where x.id=new.property_id and x.draft_data is not null and not (TG_TABLE_NAME=''calendar_sources'' and private.calendar_draft_room(x))) then raise exception ''REVIEW_REQUIRED'';end if;');
end$$;

do $$declare f text;def text;
 a_old text:='if not p.active or not exists(select 1 from pg_timezone_names where name=p.timezone) then';
 a_new text:='if (not p.active and not private.calendar_draft_room(p)) or not exists(select 1 from pg_timezone_names where name=p.timezone) then';
 b_old text:='if not s.enabled or not p.active then';
 b_new text:='if not s.enabled or (not p.active and not private.calendar_draft_room(p)) then';
begin
 foreach f in array array['bloom_calendar_add_source','bloom_owner_calendar_add_source','bloom_owner_calendar_finish_sync','bloom_calendar_finish_before_visits'] loop
  select pg_get_functiondef(oid) into def from pg_proc where proname=f and pronamespace='public'::regnamespace;
  if position(a_old in def)=0 then raise exception 'active check not found in %',f;end if;
  execute replace(def,a_old,a_new);
 end loop;
 foreach f in array array['bloom_calendar_begin_sync','bloom_owner_calendar_begin_sync'] loop
  select pg_get_functiondef(oid) into def from pg_proc where proname=f and pronamespace='public'::regnamespace;
  if position(b_old in def)=0 then raise exception 'sync check not found in %',f;end if;
  execute replace(def,b_old,b_new);
 end loop;
 -- Room calendar apply: store bookings for drafts, attach cleanings only once published.
 select pg_get_functiondef(oid) into def from pg_proc where proname='calendar_apply' and pronamespace='private'::regnamespace;
 if position('if old_e.source_status=''active'' and private.calendar_job_eligible(old_e) then' in def)=0
  or position('elsif private.calendar_job_eligible(e) and e.source_status=''active'' then' in def)=0 then raise exception 'calendar_apply branches not found';end if;
 def:=replace(def,'if old_e.source_status=''active'' and private.calendar_job_eligible(old_e) then','if old_e.source_status=''active'' and private.calendar_job_eligible(old_e) and p.draft_data is null then');
 def:=replace(def,'elsif private.calendar_job_eligible(e) and e.source_status=''active'' then','elsif private.calendar_job_eligible(e) and e.source_status=''active'' and p.draft_data is null then');
 execute def;
 -- Discarding a draft turns its calendars off so scheduled syncs stop.
 def:=pg_get_functiondef('public.bloom_listing_drafts(uuid,text,jsonb,integer,text)'::regprocedure);
 if position('if p_action=''discard'' then update public.properties set deleted_at=clock_timestamp(),draft_revision=draft_revision+1 where id=p.id;' in def)=0 then raise exception 'discard branch not found';end if;
 execute replace(def,'if p_action=''discard'' then update public.properties set deleted_at=clock_timestamp(),draft_revision=draft_revision+1 where id=p.id;',
  'if p_action=''discard'' then update public.properties set deleted_at=clock_timestamp(),draft_revision=draft_revision+1 where id=p.id;update public.calendar_sources set enabled=false where property_id=p.id and enabled;');
end$$;

