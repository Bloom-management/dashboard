begin;
alter function private.inbox_items() rename to inbox_items_before_network_prompt;
create function private.inbox_items() returns table(id text,body text,href text,dismissible boolean)
language plpgsql stable security definer set search_path='' as $$
declare actor public.users;begin
 actor:=private.require_actor();
 return query select i.id,i.body,i.href,i.dismissible from private.inbox_items_before_network_prompt() i;
 if actor.role='cleaner' and not actor.bloom_network_enabled then
  return query select 'network:opportunities'::text,'Receive opportunities from Bloom alongside your private cleanings.'::text,'/cleaner?network=1'::text,true;
 end if;
end $$;
revoke all on function private.inbox_items(),private.inbox_items_before_network_prompt() from public,anon,authenticated,service_role;
commit;
