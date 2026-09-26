begin;
-- Reuse the shared inbox; this prompt resolves when the owner has a listing.
alter function private.inbox_items() rename to inbox_items_before_owner_listing;
create function private.inbox_items() returns table(id text,body text,href text,dismissible boolean)
language plpgsql stable security definer set search_path='' as $$
declare actor public.users;begin
 actor:=private.require_actor();
 return query select i.id,i.body,i.href,i.dismissible from private.inbox_items_before_owner_listing() i;
 if actor.role='owner' and not exists(
  select 1 from public.property_owners po join public.properties p on p.id=po.property_id
  where po.owner_id=actor.id and p.deleted_at is null
 ) then
  return query select 'owner:first-listing'::text,'Add your first listing'::text,'/owner?view=listings&create=1'::text,false;
 end if;
end $$;
revoke all on function private.inbox_items(),private.inbox_items_before_owner_listing() from public,anon,authenticated,service_role;
commit;
