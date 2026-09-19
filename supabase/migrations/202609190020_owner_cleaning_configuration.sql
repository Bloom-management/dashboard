begin;
create or replace function public.bloom_cleaning_config(p_property uuid,p_config jsonb default null,p_key text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;old_config jsonb;r jsonb;v jsonb;seen uuid[];input jsonb:=jsonb_build_object('property',p_property,'config',p_config);begin
 u:=private.require_actor();
 if u.role not in ('owner','admin') then raise exception 'FORBIDDEN';end if;
 -- Property lock serializes deletion, ownership changes, calendar sync and setup release.
 select cleaning_config into old_config from public.properties where id=p_property and deleted_at is null for update;
 if not found then raise exception 'NOT_FOUND';end if;
 select * into u from public.users where id=u.id for share;
 if u.role not in ('owner','admin') then raise exception 'FORBIDDEN';end if;
 if u.role='owner' then
 perform 1 from public.property_owners where property_id=p_property and owner_id=u.id for share;
 if not found then raise exception 'NOT_FOUND';end if;
 end if;
 -- Authorization is checked again even when replaying a previously successful receipt.
 if p_config is not null then r:=private.receipt('cleaning_config',p_key,input);if r is not null then return r;end if;end if;
 if p_config is null then return old_config;end if;
 if jsonb_typeof(p_config)<>'object' or exists(select 1 from jsonb_object_keys(p_config) k where k not in ('version','rooms','supplies'))
 or jsonb_typeof(p_config->'version') is distinct from 'number' or (p_config->>'version')::numeric<0 or (p_config->>'version')::numeric<>trunc((p_config->>'version')::numeric) then raise exception 'VALIDATION_ERROR';end if;
 if jsonb_typeof(p_config)<>'object' or jsonb_typeof(p_config->'rooms') is distinct from 'array' or jsonb_typeof(p_config->'supplies') is distinct from 'array'
 or jsonb_array_length(p_config->'rooms') not between 2 and 100 or jsonb_array_length(p_config->'supplies')>100 then raise exception 'VALIDATION_ERROR';end if;
 if coalesce((p_config->>'version')::integer,0)<>coalesce((old_config->>'version')::integer,0) then raise exception 'CONFLICT';end if;
 seen:=array[]::uuid[];
 for v in select value from jsonb_array_elements(p_config->'rooms') loop
 if jsonb_typeof(v)<>'object' or v->>'id' is null or (v->>'id')::uuid=any(seen) or coalesce(length(trim(v->>'label')),0) not between 1 and 100
 or v->>'type' is null or v->>'type' not in ('bedrooms','bathrooms','kitchen','living_room') or v->'requiredPhoto' is distinct from 'true'::jsonb
 then raise exception 'VALIDATION_ERROR';end if;
 if exists(select 1 from jsonb_object_keys(v) k where k not in ('id','type','label','requiredPhoto')) or jsonb_typeof(v->'label')<>'string' then raise exception 'VALIDATION_ERROR';end if;
 seen:=array_append(seen,(v->>'id')::uuid);
 end loop;
 if not exists(select 1 from jsonb_array_elements(p_config->'rooms') room_check where room_check->>'type'='kitchen') or not exists(select 1 from jsonb_array_elements(p_config->'rooms') room_check where room_check->>'type'='living_room') then raise exception 'VALIDATION_ERROR';end if;
 seen:=array[]::uuid[];
 for v in select value from jsonb_array_elements(p_config->'supplies') loop
 if jsonb_typeof(v)<>'object' or v->>'id' is null or (v->>'id')::uuid=any(seen) or coalesce(length(trim(v->>'name')),0) not between 1 and 100 then raise exception 'VALIDATION_ERROR';end if;
 if exists(select 1 from jsonb_object_keys(v) k where k not in ('id','name')) or jsonb_typeof(v->'name')<>'string' then raise exception 'VALIDATION_ERROR';end if;
 seen:=array_append(seen,(v->>'id')::uuid);
 end loop;
 r:=jsonb_build_object('version',coalesce((old_config->>'version')::integer,0)+1,'rooms',p_config->'rooms','supplies',p_config->'supplies');
 if (select count(*) from jsonb_array_elements(p_config->'rooms') x where x->>'type'='bedrooms')>20 or (select count(*) from jsonb_array_elements(p_config->'rooms') x where x->>'type'='bathrooms')>20 then raise exception 'VALIDATION_ERROR';end if;
 update public.properties set cleaning_config=r,
 bedroom_count=(select count(*) from jsonb_array_elements(p_config->'rooms') x where x->>'type'='bedrooms'),
 bathroom_count=(select count(*) from jsonb_array_elements(p_config->'rooms') x where x->>'type'='bathrooms') where id=p_property;
 return private.save_receipt('cleaning_config',p_key,input,r);end $$;

revoke all on function public.bloom_cleaning_config(uuid,jsonb,text) from public,anon;
grant execute on function public.bloom_cleaning_config(uuid,jsonb,text) to authenticated;
commit;
