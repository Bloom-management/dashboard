begin;
-- Live inbox reminder: one stable item per unfinished property, resolving on save.
alter function private.inbox_items() rename to inbox_items_before_property_setup;
create function private.inbox_items() returns table(id text,body text,href text,dismissible boolean)
language plpgsql stable security definer set search_path='' as $$
declare actor public.users;begin
 actor:=private.require_actor();
 return query select i.id,i.body,i.href,i.dismissible from private.inbox_items_before_property_setup() i;
 if actor.role in ('admin','owner') then
  return query select 'property:setup:'||p.id,
   'Finish cleaning setup for '||p.name||'. Save the room checklist in Settings; supplies are optional.',
   case when actor.role='admin' then '/admin?view=properties' else '/owner?view=listings' end||'&property='||p.id||'&section=settings',false
  from public.properties p where p.active and p.deleted_at is null and p.cleaning_config is null
   and (actor.role='admin' or exists(select 1 from public.property_owners po where po.property_id=p.id and po.owner_id=actor.id));
 end if;
end $$;
revoke all on function private.inbox_items(),private.inbox_items_before_property_setup() from public,anon,authenticated,service_role;
commit;
