begin;
create table private.property_pin_suggestions(
 property_id uuid primary key references public.properties, latitude double precision not null check(latitude between -85.051129 and 85.051129),
 longitude double precision not null check(longitude between -180 and 180), address text not null,
 suggested_by uuid not null references public.users, suggested_at timestamptz not null default now());
create function public.bloom_property_pin_suggestion(p_property uuid,p_pin jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users; a text; begin
 u:=private.require_actor();
 if u.role not in ('admin','owner') then raise exception 'FORBIDDEN';end if;
 select address into a from public.properties where id=p_property and deleted_at is null for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if u.role<>'admin' and not exists(select 1 from public.property_owners where property_id=p_property and owner_id=u.id) then raise exception 'FORBIDDEN';end if;
 if p_pin is not null then
  if jsonb_typeof(p_pin->'latitude') is distinct from 'number' or jsonb_typeof(p_pin->'longitude') is distinct from 'number' or p_pin->'confirmed' is distinct from 'true'::jsonb or p_pin->>'address' is distinct from a
   or (p_pin->>'latitude')::double precision not between -85.051129 and 85.051129 or (p_pin->>'longitude')::double precision not between -180 and 180 then raise exception 'VALIDATION_ERROR';end if;
  insert into private.property_pin_suggestions(property_id,latitude,longitude,address,suggested_by) values(p_property,(p_pin->>'latitude')::double precision,(p_pin->>'longitude')::double precision,a,u.id)
  on conflict(property_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,address=excluded.address,suggested_by=u.id,suggested_at=now();
 end if;
 return (select jsonb_build_object('latitude',latitude,'longitude',longitude,'address',address) from private.property_pin_suggestions where property_id=p_property and address=a);
end $$;
create function private.clear_pin_suggestion() returns trigger language plpgsql security definer set search_path='' as $$ begin delete from private.property_pin_suggestions where property_id=new.property_id;return new;end $$;
create trigger confirmed_pin_clears_suggestion after insert or update on private.property_pins for each row execute function private.clear_pin_suggestion();
revoke all on function private.clear_pin_suggestion() from public,anon,authenticated;
revoke all on function public.bloom_property_pin_suggestion(uuid,jsonb) from public,anon;
grant execute on function public.bloom_property_pin_suggestion(uuid,jsonb) to authenticated;
commit;
