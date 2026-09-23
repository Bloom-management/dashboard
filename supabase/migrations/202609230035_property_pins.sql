begin;
-- Deliberate, administrator-confirmed coordinates; no automatic geocoding.
create table private.property_pins(property_id uuid primary key references public.properties,
 latitude double precision not null check(latitude between -85.051129 and 85.051129),
 longitude double precision not null check(longitude between -180 and 180),
 confirmed_by uuid not null references public.users,confirmed_at timestamptz not null default now());
create function public.bloom_property_pin(p_property uuid,p_pin jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;begin
 u:=private.require_actor('admin');
 perform 1 from public.properties where id=p_property and deleted_at is null for update;if not found then raise exception 'NOT_FOUND';end if;
 if p_pin is not null then
  if p_pin='null'::jsonb then delete from private.property_pins where property_id=p_property;
  else
   if jsonb_typeof(p_pin->'latitude') is distinct from 'number' or jsonb_typeof(p_pin->'longitude') is distinct from 'number' or p_pin->'confirmed' is distinct from 'true'::jsonb
    or (p_pin->>'latitude')::double precision not between -85.051129 and 85.051129 or (p_pin->>'longitude')::double precision not between -180 and 180 then raise exception 'VALIDATION_ERROR';end if;
   insert into private.property_pins(property_id,latitude,longitude,confirmed_by) values(p_property,(p_pin->>'latitude')::double precision,(p_pin->>'longitude')::double precision,u.id)
   on conflict(property_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,confirmed_by=u.id,confirmed_at=now();
  end if;
 end if;
 return (select jsonb_build_object('latitude',latitude,'longitude',longitude) from private.property_pins where property_id=p_property);
end $$;
create function public.bloom_day_pins(p_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 -- Reuse exactly the jobs authorization policy, including existing assignment exceptions.
 return (select coalesce(jsonb_agg(jsonb_build_object('jobId',j->>'id','latitude',p.latitude,'longitude',p.longitude)),'[]')
 from jsonb_array_elements(public.bloom_jobs(p_date,p_date)) j join private.property_pins p on p.property_id=(j->>'propertyId')::uuid);
end $$;
revoke all on function public.bloom_property_pin(uuid,jsonb),public.bloom_day_pins(date) from public,anon;
grant execute on function public.bloom_property_pin(uuid,jsonb),public.bloom_day_pins(date) to authenticated;
commit;
