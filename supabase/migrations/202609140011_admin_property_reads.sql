begin;
-- Rates must not be granted to all authenticated users; this read is admin-only.
create function public.bloom_admin_property_options(p_id uuid default null,p_cursor uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.require_actor('admin');
 with page as (select p.* from public.properties p where (p_id is null or p.id=p_id) and (p_cursor is null or p.id>p_cursor) order by p.id limit 101),
 shown as (select * from page order by id limit 100)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
 'id',p.id,'name',p.name,'cityId',p.city_id,'timezone',p.timezone,'address',p.address,'isBloomOwned',p.is_bloom_owned,'active',p.active,
 'soloRateCents',p.solo_rate_cents,'instructions',coalesce((select instructions from public.property_entry_instructions where property_id=p.id),''),
 'ownerIds',coalesce((select jsonb_agg(owner_id order by owner_id) from public.property_owners where property_id=p.id),'[]'::jsonb)) order by p.id) from shown p),'[]'::jsonb),
 'nextCursor',case when (select count(*) from page)>100 then (select max(id::text) from shown) else null end) into result;
 return result;
end $$;
revoke all on function public.bloom_admin_property_options(uuid,uuid) from public,anon;
grant execute on function public.bloom_admin_property_options(uuid,uuid) to authenticated;
commit;
