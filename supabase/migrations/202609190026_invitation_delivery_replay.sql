begin;
-- A delayed delivery receipt cannot undo an already accepted invitation.
create or replace function public.bloom_property_invite_delivery(p_actor uuid,p_id uuid,p_lease uuid default null,p_delivery text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.property_invitations;pid uuid;begin
 perform private.people_service();select property_id into pid from private.property_invitations where id=p_id;
 perform 1 from public.properties where id=pid for update;
 select * into i from private.property_invitations where id=p_id for update;
 if i.id is null or not private.people_access(i.property_id,p_actor) or not private.people_access(i.property_id,i.actor_id) then raise exception 'NOT_FOUND';end if;
 if i.expires_at<=clock_timestamp() then raise exception 'INVALID_STATE';end if;
 if p_lease is not null then
  if i.delivery_lease is distinct from p_lease or p_delivery is null or length(p_delivery)>200 then raise exception 'CONFLICT';end if;
  if i.status<>'pending' then
   if i.delivery_id is distinct from p_delivery then raise exception 'CONFLICT';end if;
  else
   update private.property_invitations set status='sent',delivery_id=p_delivery,lease_until=null where id=i.id returning * into i;
  end if;
 elsif i.status='pending' then
  if i.lease_until>clock_timestamp() then raise exception 'CONFLICT';end if;
  update private.property_invitations set delivery_lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes' where id=i.id returning * into i;
 end if;
 return jsonb_build_object('id',i.id,'email',i.email,'status',i.status,'expiresAt',i.expires_at,'lease',case when i.status='pending' then i.delivery_lease end);
end $$;
commit;
