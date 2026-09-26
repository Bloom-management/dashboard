begin;
-- Existing registered cities may host private cleaning even when Bloom does not service them.
-- This never activates a city or changes cleaner network eligibility.
create function public.bloom_owner_property_cities() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u public.users;begin u:=private.require_actor();if u.role not in ('owner','admin') then raise exception 'FORBIDDEN';end if;
return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active) order by name),'[]') from public.cities);end$$;
revoke all on function public.bloom_owner_property_cities() from public,anon,service_role;
grant execute on function public.bloom_owner_property_cities() to authenticated;
create or replace function public.bloom_owner_listing_create(p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;r jsonb;pid uuid;v text;n numeric;listing jsonb;begin
 u:=private.require_actor('owner');
 r:=private.receipt('owner_listing_create',p_key,p_input);if r is not null then return r;end if;
 -- Match property-owner insertion's user lock; acquiring a shared lock first would deadlock on upgrade.
 perform 1 from public.users where id=u.id and role='owner' for update;if not found then raise exception 'FORBIDDEN';end if;
 if p_input is null or jsonb_typeof(p_input)<>'object' or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('name','address','cityId','timezone','bedroomCount','bathroomCount')) then raise exception 'VALIDATION_ERROR';end if;
 if jsonb_typeof(p_input->'name') is distinct from 'string' or length(trim(p_input->>'name')) not between 1 and 200
 or jsonb_typeof(p_input->'address') is distinct from 'string' or length(trim(p_input->>'address')) not between 1 and 500
 or jsonb_typeof(p_input->'timezone') is distinct from 'string' or not exists(select 1 from pg_timezone_names where name=p_input->>'timezone')
 or jsonb_typeof(p_input->'cityId') is distinct from 'string' then raise exception 'VALIDATION_ERROR';end if;
 foreach v in array array['bedroomCount','bathroomCount'] loop
 if jsonb_typeof(p_input->v) is distinct from 'number' then raise exception 'VALIDATION_ERROR';end if;
 n:=(p_input->>v)::numeric;if n<>trunc(n) or n not between 0 and 20 then raise exception 'VALIDATION_ERROR';end if;
 end loop;
 perform 1 from public.cities where id=(p_input->>'cityId')::uuid for share;
 if not found then raise exception 'VALIDATION_ERROR';end if;
 insert into public.properties(city_id,name,address,timezone,is_bloom_owned,owner_created,bedroom_count,bathroom_count)
 values((p_input->>'cityId')::uuid,trim(p_input->>'name'),trim(p_input->>'address'),p_input->>'timezone',false,true,((p_input->>'bedroomCount')::numeric)::integer,((p_input->>'bathroomCount')::numeric)::integer) returning id into pid;
 insert into public.property_owners(property_id,owner_id) values(pid,u.id);
 -- Creation response is the same safe shape as owner listings, independent of pagination.
 listing:=jsonb_build_object('id',pid,'name',trim(p_input->>'name'),'timezone',p_input->>'timezone','active',true,'setupRequired',true,
 'bedroomCount',((p_input->>'bedroomCount')::numeric)::integer,'bathroomCount',((p_input->>'bathroomCount')::numeric)::integer,
 'supplies','[]'::jsonb,'sources','[]'::jsonb,'nightlyGuestRateCents',null,'hostPayoutCents',null,'currency','USD');
 return private.save_receipt('owner_listing_create',p_key,p_input,jsonb_build_object('listing',listing));
end $$;
commit;
