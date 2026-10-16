begin;
alter table public.cities add column locality_name text,add column region text,add column country_code text,add column mapbox_id text,add column cleaning_coverage text not null default 'unavailable' check(cleaning_coverage in ('unavailable','waitlist','available','paused'));
update public.cities set locality_name=name,cleaning_coverage=case when active then 'available' else 'unavailable' end;
update public.cities set region='Michigan',country_code='US' where lower(name)='detroit';
create unique index cities_mapbox_identity on public.cities(mapbox_id) where mapbox_id is not null;
create unique index cities_location_identity on public.cities(lower(locality_name),lower(region),country_code) where region is not null and country_code is not null;

-- Called only by the server after verifying a signed Mapbox place selection.
create function public.bloom_city_register(p_actor uuid,p_place jsonb,p_timezone text) returns jsonb language plpgsql security definer set search_path='' as $$
declare found_city public.cities;begin
 if not exists(select 1 from public.users where id=p_actor and role in ('owner','admin','cleaner')) then raise exception 'FORBIDDEN';end if;
 if coalesce(length(p_place->>'id'),0) not between 1 and 250 or coalesce(length(p_place->>'name'),0) not between 1 and 150 or coalesce(length(p_place->>'region'),0) not between 1 and 150 or coalesce(p_place->>'country','') !~ '^[A-Z]{2}$' or not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'VALIDATION_ERROR';end if;
 perform pg_advisory_xact_lock(hashtextextended('city:'||lower(p_place->>'name')||':'||lower(p_place->>'region')||':'||(p_place->>'country'),0));
 select * into found_city from public.cities where mapbox_id=p_place->>'id' or (lower(locality_name)=lower(p_place->>'name') and lower(region)=lower(p_place->>'region') and country_code=p_place->>'country') limit 1;
 if found_city.id is null then
  insert into public.cities(name,locality_name,region,country_code,mapbox_id,active,notification_timezone,cleaning_coverage)
  values(p_place->>'label',p_place->>'name',p_place->>'region',p_place->>'country',p_place->>'id',true,p_timezone,'unavailable') returning * into found_city;
 end if;
 return jsonb_build_object('id',found_city.id,'name',found_city.name,'active',found_city.active,'timezone',found_city.notification_timezone,'coverage',found_city.cleaning_coverage);
end $$;
revoke all on function public.bloom_city_register(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.bloom_city_register(uuid,jsonb,text) to service_role;

create function public.bloom_city_coverage(p_city uuid,p_status text,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;r jsonb;i jsonb:=jsonb_build_object('city',p_city,'status',p_status);begin
 u:=private.require_actor('admin');r:=private.receipt('city_coverage',p_key,i);if r is not null then return r;end if;
 if p_status is null or p_status not in ('unavailable','waitlist','available','paused') then raise exception 'VALIDATION_ERROR';end if;
 update public.cities set cleaning_coverage=p_status where id=p_city;
 if not found then raise exception 'NOT_FOUND';end if;
 return private.save_receipt('city_coverage',p_key,i,jsonb_build_object('id',p_city,'coverage',p_status));
end $$;
revoke all on function public.bloom_city_coverage(uuid,text,text) from public,anon;
grant execute on function public.bloom_city_coverage(uuid,text,text) to authenticated;

-- Coverage gates new Bloom commitments only. Existing jobs and cleaner city access remain intact.
do $$
declare target regprocedure;definition text;begin
 foreach target in array array['public.bloom_property_team_action(uuid,text,jsonb,text)'::regprocedure,'public.bloom_private_job_action(uuid,text,jsonb,text)'::regprocedure,'private.manual_create_job(uuid,date,jsonb,text,uuid)'::regprocedure,'public.bloom_calendar_add_options()'::regprocedure,'public.bloom_calendar_add(jsonb,text)'::regprocedure] loop
  definition:=pg_get_functiondef(target);
  definition:=replace(definition,'id=p.city_id and active','id=p.city_id and cleaning_coverage=''available''');
  definition:=replace(definition,'p.id=j.property_id and c.active','p.id=j.property_id and c.cleaning_coverage=''available''');
  definition:=replace(definition,'''bloomAvailable'',c.active','''bloomAvailable'',c.cleaning_coverage=''available''');
  execute definition;
 end loop;
end $$;

create or replace function public.bloom_owner_property_cities() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u public.users;begin u:=private.require_actor();if u.role not in ('owner','admin') then raise exception 'FORBIDDEN';end if;
return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active,'coverage',cleaning_coverage,'timezone',notification_timezone) order by name),'[]') from public.cities);end$$;
alter function public.bloom_property_team(uuid) rename to bloom_property_team_before_coverage;
revoke all on function public.bloom_property_team_before_coverage(uuid) from public,anon,authenticated,service_role;
create function public.bloom_property_team(p_property uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 result:=public.bloom_property_team_before_coverage(p_property);
 return result||jsonb_build_object('coverage',(select c.cleaning_coverage from public.properties p join public.cities c on c.id=p.city_id where p.id=p_property));
end $$;
revoke all on function public.bloom_property_team(uuid) from public,anon;
grant execute on function public.bloom_property_team(uuid) to authenticated;
commit;
