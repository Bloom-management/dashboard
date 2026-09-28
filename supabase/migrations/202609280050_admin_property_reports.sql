begin;
-- One authorized listing projection for owners and admins, preserving the public
-- maintenance wrapper and per-owner isolation. No reports are rewritten.
create or replace function private.bloom_owner_listings(p_cursor uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u public.users;r jsonb;begin
 u:=private.require_actor();
 if u.role not in ('admin','owner') then raise exception 'FORBIDDEN';end if;
 with page as (select p.* from public.properties p where p.deleted_at is null and (u.role='admin' or exists(select 1 from public.property_owners po where po.property_id=p.id and po.owner_id=u.id)) and (p_cursor is null or p.id>p_cursor) order by p.id limit 101),
 shown as (select * from page order by id limit 100)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
 'setupRequired',p.owner_created and p.cleaning_config is null,'bedroomCount',p.bedroom_count,'bathroomCount',p.bathroom_count,'id',p.id,'name',p.name,'timezone',p.timezone,'active',p.active,'nightlyGuestRateCents',null,'hostPayoutCents',null,'currency','USD',
 'supplies',coalesce((select jsonb_agg(jsonb_build_object('supplyId',c.value->>'id','name',c.value->>'name','level',r.level,'reportedAt',r.reported_at) order by c.ordinality)
 from jsonb_array_elements(coalesce(p.cleaning_config->'supplies','[]'::jsonb)) with ordinality c(value,ordinality)
 left join lateral (select x.level,x.reported_at from public.job_supply_reports x join public.jobs j on j.id=x.job_id
 where j.property_id=p.id and j.status='completed' and x.supply_id=(c.value->>'id')::uuid order by j.completed_at desc,x.reported_at desc,j.id desc limit 1) r on true),'[]'::jsonb),
 'sources',coalesce((select jsonb_agg(private.owner_source(s.id) order by s.id) from public.calendar_sources s where s.property_id=p.id),'[]'::jsonb)
 ) order by p.id) from shown p),'[]'::jsonb),
 'nextCursor',case when (select count(*) from page)>100 then (select max(id::text) from shown) else null end) into r;
 return r;
end $$;
revoke all on function private.bloom_owner_listings(uuid) from public,anon,authenticated,service_role;
commit;
