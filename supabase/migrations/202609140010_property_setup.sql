begin;
-- Atomic setup: ownership and private instructions are committed with the property.
-- No role changes, cleaner mutations or reconciliation rules are altered.
create or replace function public.bloom_admin_property(p_data jsonb,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb;pid uuid;oid uuid;bloom boolean;rate numeric;
begin
 perform private.require_actor('admin');
 r:=private.receipt('admin_property',p_key,p_data);if r is not null then return r;end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('cityId','name','timezone','address','instructions','isBloomOwned','soloRateCents','ownerIds')) then raise exception 'VALIDATION_ERROR';end if;
 if jsonb_typeof(p_data->'isBloomOwned') is distinct from 'boolean' or jsonb_typeof(p_data->'ownerIds') is distinct from 'array' or jsonb_typeof(p_data->'soloRateCents') is distinct from 'number' then raise exception 'VALIDATION_ERROR';end if;
 if jsonb_typeof(p_data->'name') is distinct from 'string' or length(trim(p_data->>'name')) not between 1 and 200
 or jsonb_typeof(p_data->'address') is distinct from 'string' or length(trim(p_data->>'address')) not between 1 and 500
 or jsonb_typeof(p_data->'timezone') is distinct from 'string' or length(p_data->>'timezone') not between 1 and 100
 or jsonb_typeof(p_data->'instructions') is distinct from 'string' or length(trim(p_data->>'instructions')) not between 1 and 5000 then raise exception 'VALIDATION_ERROR';end if;
 bloom:=(p_data->>'isBloomOwned')::boolean;rate:=(p_data->>'soloRateCents')::numeric;
 if rate<>trunc(rate) or rate not between 2 and 2147483646 or mod(rate,2)<>0 then raise exception 'VALIDATION_ERROR';end if;
 if jsonb_array_length(p_data->'ownerIds')>100 or (bloom and jsonb_array_length(p_data->'ownerIds')<>0) or (not bloom and jsonb_array_length(p_data->'ownerIds')=0) then raise exception 'VALIDATION_ERROR';end if;
 if exists(select 1 from jsonb_array_elements(p_data->'ownerIds') v where jsonb_typeof(v)<>'string') then raise exception 'VALIDATION_ERROR';end if;
 if not exists(select 1 from public.cities where id=(p_data->>'cityId')::uuid and active) then raise exception 'VALIDATION_ERROR';end if;
 for oid in select distinct value::uuid from jsonb_array_elements_text(p_data->'ownerIds') order by 1 loop
  perform 1 from public.users where id=oid and role='owner' for update;if not found then raise exception 'VALIDATION_ERROR';end if;
 end loop;
 insert into public.properties(city_id,name,timezone,address,is_bloom_owned,solo_rate_cents)
 values((p_data->>'cityId')::uuid,trim(p_data->>'name'),p_data->>'timezone',trim(p_data->>'address'),bloom,rate::integer) returning id into pid;
 insert into public.property_entry_instructions(property_id,instructions) values(pid,trim(p_data->>'instructions'));
 insert into public.property_owners(property_id,owner_id) select pid,value::uuid from jsonb_array_elements_text(p_data->'ownerIds');
 select to_jsonb(p) into r from public.properties p where id=pid;
 return private.save_receipt('admin_property',p_key,p_data,r);
end $$;
revoke all on function public.bloom_admin_property(jsonb,text) from public,anon;
grant execute on function public.bloom_admin_property(jsonb,text) to authenticated;

-- Private feed rows remain inaccessible; property settings receive redacted health only.
create function public.bloom_calendar_property_sources(p_actor uuid,p_property uuid,p_cursor uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.calendar_actor(p_actor,true);
 if not exists(select 1 from public.properties where id=p_property) then perform private.calendar_error('NOT_FOUND');end if;
 select jsonb_build_object('items',coalesce(jsonb_agg(private.calendar_health(s.id) order by s.id),'[]'::jsonb),
 'nextCursor',case when count(*)=100 then max(s.id::text) else null end) into result
 from (select id from public.calendar_sources where property_id=p_property and (p_cursor is null or id>p_cursor) order by id limit 100) s;
 return result;
end $$;
revoke all on function public.bloom_calendar_property_sources(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.bloom_calendar_property_sources(uuid,uuid,uuid) to service_role;
commit;
