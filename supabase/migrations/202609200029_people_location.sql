begin;
-- Keep profile locations inside the existing property access boundary.
create or replace function public.bloom_property_people(p_property uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;begin
 u:=private.require_actor();if not private.people_access(p_property,u.id) then raise exception 'NOT_FOUND';end if;
 return jsonb_build_object('propertyId',p_property,'bloomOwned',(select is_bloom_owned from public.properties where id=p_property),
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'displayName',m.display_name,'subject',m.clerk_user_id,'location',m.home_base) order by m.id) from public.property_owners po join public.users m on m.id=po.owner_id where po.property_id=p_property),'[]'),
 'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'status',case when i.status<>'accepted' and i.expires_at<=clock_timestamp() then 'expired' else i.status end,'expiresAt',i.expires_at) order by i.created_at desc) from private.property_invitations i where i.property_id=p_property),'[]'));
end $$;

notify pgrst, 'reload schema';
commit;
