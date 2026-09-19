begin;
-- Name only. No UPDATE grant or service-role path is added.
create function public.bloom_property_rename(p_property uuid,p_name text,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.users;v_name text;r jsonb;i jsonb;begin
 u:=private.require_actor();
 if u.role not in ('admin','owner') then raise exception 'FORBIDDEN';end if;
 v_name:=regexp_replace(p_name,'^[[:space:]]+|[[:space:]]+$','','g');
 if v_name is null or length(v_name) not between 1 and 200 then raise exception 'VALIDATION_ERROR';end if;
 -- Property first, matching calendar/admin locking. Recheck actor and membership
 -- under locks BEFORE receipt replay, so revoked owners cannot replay a success.
 perform 1 from public.properties where id=p_property for update;
 if not found then raise exception 'NOT_FOUND';end if;
 select * into u from public.users where id=u.id for share;
 if u.role not in ('admin','owner') then raise exception 'FORBIDDEN';end if;
 if u.role='owner' then
  perform 1 from public.property_owners where property_id=p_property and owner_id=u.id for share;
  if not found then raise exception 'NOT_FOUND';end if;
 end if;
 i:=jsonb_build_object('propertyId',p_property,'name',v_name);
 r:=private.receipt('property_rename',p_key,i);if r is not null then return r;end if;
 update public.properties set name=v_name where id=p_property;
 r:=jsonb_build_object('id',p_property,'name',v_name);
 return private.save_receipt('property_rename',p_key,i,r);
end $$;
revoke all on function public.bloom_property_rename(uuid,text,text) from public,anon,service_role;
grant execute on function public.bloom_property_rename(uuid,text,text) to authenticated;
commit;
