begin;
alter table public.property_entry_instructions add column access_info jsonb not null default '{"entryType":"other","code":"","entryNotes":"","parking":[],"garageCode":"","parkingNotes":""}'::jsonb;
create or replace function public.bloom_property_access_info(p_property uuid,p_input jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users; item jsonb; current_info jsonb;begin
 u:=private.require_actor();
 if not private.people_access(p_property,u.id) and not (p_input is null and private.entry_access(p_property)) then raise exception 'NOT_FOUND';end if;
 if p_input is not null then
  if jsonb_typeof(p_input) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('entryType','code','entryNotes','parking','garageCode','parkingNotes','version')) then raise exception 'VALIDATION_ERROR';end if;
  if p_input->>'entryType' is null or p_input->>'entryType' not in ('keypad','key','lockbox','other') or jsonb_typeof(p_input->'parking') is distinct from 'array' then raise exception 'VALIDATION_ERROR';end if;
  for item in select value from jsonb_array_elements(p_input->'parking') loop if jsonb_typeof(item)<>'string' or item#>>'{}' not in ('free_street','paid_street','driveway','garage') then raise exception 'VALIDATION_ERROR';end if;end loop;
  if jsonb_array_length(p_input->'parking')>4 or (select count(distinct value) from jsonb_array_elements(p_input->'parking'))<>jsonb_array_length(p_input->'parking') then raise exception 'VALIDATION_ERROR';end if;
  if exists(select 1 from unnest(array['code','entryNotes','garageCode','parkingNotes']) k where jsonb_typeof(p_input->k) is distinct from 'string' or length(p_input->>k)>2000) then raise exception 'VALIDATION_ERROR';end if;
  perform 1 from public.properties where id=p_property for update;
  select access_info into current_info from public.property_entry_instructions where property_id=p_property;
  if (p_input->>'version')::integer is distinct from coalesce((current_info->>'version')::integer,0) then raise exception 'CONFLICT';end if;
  insert into public.property_entry_instructions(property_id,instructions,access_info) values(p_property,'',p_input||jsonb_build_object('version',coalesce((current_info->>'version')::integer,0)+1)) on conflict(property_id) do update set access_info=excluded.access_info;
 end if;
 return coalesce((select jsonb_build_object('info',access_info||jsonb_build_object('version',coalesce((access_info->>'version')::integer,0)),'instructions',instructions,'canEdit',private.people_access(p_property,u.id)) from public.property_entry_instructions where property_id=p_property),jsonb_build_object('info','{"entryType":"other","code":"","entryNotes":"","parking":[],"garageCode":"","parkingNotes":"","version":0}'::jsonb,'instructions','','canEdit',private.people_access(p_property,u.id)));
end $$;
revoke all on function public.bloom_property_access_info(uuid,jsonb) from public,anon;
grant execute on function public.bloom_property_access_info(uuid,jsonb) to authenticated;
commit;
