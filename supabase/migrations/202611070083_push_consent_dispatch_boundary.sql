begin;
-- Legacy completion/import publishers also feed the inbox while push is off.
-- Those messages must not become a push backlog when the account is re-enabled.
alter table private.push_preferences add column push_enabled_since timestamptz not null default '-infinity';
create function private.push_consent_boundary() returns trigger language plpgsql set search_path='' as $$
begin
 if new.push_enabled and not old.push_enabled then new.push_enabled_since:=now();end if;return new;
end $$;
create trigger push_consent_boundary before update of push_enabled on private.push_preferences for each row execute function private.push_consent_boundary();
alter function public.bloom_push_delivery(uuid,uuid,text) rename to bloom_push_delivery_before_consent_boundary;
revoke all on function public.bloom_push_delivery_before_consent_boundary(uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.bloom_push_delivery(p_id uuid,p_lease uuid default null,p_device text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_lease is not null and exists(
  select 1 from private.push_deliveries d join private.push_messages m on m.id=d.message_id join private.push_preferences s on s.user_id=m.user_id
  where d.id=p_id and m.created_at<s.push_enabled_since
 ) then return null;end if;
 -- Already accepted alert opens retain their existing authorization path.
 return public.bloom_push_delivery_before_consent_boundary(p_id,p_lease,p_device);
end $$;
revoke all on function private.push_consent_boundary(),public.bloom_push_delivery(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.bloom_push_delivery(uuid,uuid,text) to service_role;
commit;
