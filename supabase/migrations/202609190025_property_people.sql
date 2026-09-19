begin;
create table private.property_invitations(
 id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties,
 actor_id uuid not null references public.users,email text not null check(email=lower(btrim(email)) and length(email)<=254),
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default clock_timestamp()+interval '7 days',
 status text not null default 'pending' check(status in ('pending','sent','accepted','expired')),
 delivery_id text,delivery_lease uuid,lease_until timestamptz,accepted_by uuid references public.users,accepted_at timestamptz
);
create unique index one_property_invitation on private.property_invitations(property_id,email) where status in ('pending','sent');
revoke all on private.property_invitations from public,anon,authenticated,service_role;
create function private.people_access(p_property uuid,p_actor uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.properties p join public.users u on u.id=p_actor where p.id=p_property and p.deleted_at is null and p.active
 and (u.role='admin' or (u.role='owner' and exists(select 1 from public.property_owners po where po.property_id=p.id and po.owner_id=u.id))))
$$;
revoke all on function private.people_access(uuid,uuid) from public,anon,authenticated,service_role;
create function public.bloom_property_people(p_property uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;begin
 u:=private.require_actor();if not private.people_access(p_property,u.id) then raise exception 'NOT_FOUND';end if;
 return jsonb_build_object('propertyId',p_property,'bloomOwned',(select is_bloom_owned from public.properties where id=p_property),
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'displayName',m.display_name,'subject',m.clerk_user_id) order by m.id) from public.property_owners po join public.users m on m.id=po.owner_id where po.property_id=p_property),'[]'),
 'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'status',case when i.status<>'accepted' and i.expires_at<=clock_timestamp() then 'expired' else i.status end,'expiresAt',i.expires_at) order by i.created_at desc) from private.property_invitations i where i.property_id=p_property),'[]'));
end $$;
create function public.bloom_property_invite(p_property uuid,p_email text,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;i private.property_invitations;r jsonb;input jsonb;begin
 u:=private.require_actor();perform 1 from public.properties where id=p_property for update;
 if not private.people_access(p_property,u.id) then raise exception 'NOT_FOUND';end if;
 if p_email is null or length(p_email)>254 or p_email<>lower(btrim(p_email)) or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'VALIDATION_ERROR';end if;
 input:=jsonb_build_object('propertyId',p_property,'email',p_email);
 r:=private.receipt('property_invite',p_key,input);
 if r is not null then return r;end if;
 update private.property_invitations set status='expired' where property_id=p_property and email=p_email and status in ('pending','sent') and expires_at<=clock_timestamp();
 select * into i from private.property_invitations where property_id=p_property and email=p_email and status in ('pending','sent');
 if i.id is null then insert into private.property_invitations(property_id,actor_id,email) values(p_property,u.id,p_email) returning * into i;end if;
 return private.save_receipt('property_invite',p_key,input,jsonb_build_object('id',i.id));
end $$;
-- Only verified server code may deliver or accept an invitation. No email/subject is trusted from HTTP input.
create function private.people_service() returns void language plpgsql set search_path='' as $$ begin
 if auth.role() is distinct from 'service_role' or current_setting('role',true) is distinct from 'service_role' then raise exception 'FORBIDDEN';end if;
end $$;
revoke all on function private.people_service() from public,anon,authenticated,service_role;
create function public.bloom_property_invite_delivery(p_actor uuid,p_id uuid,p_lease uuid default null,p_delivery text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.property_invitations;pid uuid;begin
 perform private.people_service();select property_id into pid from private.property_invitations where id=p_id;
 perform 1 from public.properties where id=pid for update;
 select * into i from private.property_invitations where id=p_id for update;
 if i.id is null or not private.people_access(i.property_id,p_actor) or not private.people_access(i.property_id,i.actor_id) then raise exception 'NOT_FOUND';end if;
 if i.expires_at<=clock_timestamp() then raise exception 'INVALID_STATE';end if;
 if p_lease is not null then
  if i.delivery_lease is distinct from p_lease or p_delivery is null or length(p_delivery)>200 then raise exception 'CONFLICT';end if;
  update private.property_invitations set status='sent',delivery_id=p_delivery,lease_until=null where id=i.id returning * into i;
 elsif i.status='pending' then
  if i.lease_until>clock_timestamp() then raise exception 'CONFLICT';end if;
  update private.property_invitations set delivery_lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes' where id=i.id returning * into i;
 end if;
 return jsonb_build_object('id',i.id,'email',i.email,'status',i.status,'expiresAt',i.expires_at,'lease',case when i.status='pending' then i.delivery_lease end);
end $$;
create function public.bloom_property_invites_incoming(p_emails text[]) returns jsonb language plpgsql security definer set search_path='' as $$ begin
 perform private.people_service();if cardinality(p_emails)>100 then raise exception 'VALIDATION_ERROR';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'propertyId',i.property_id,'propertyName',p.name,'inviterName',u.display_name,'expiresAt',i.expires_at) order by i.created_at) from private.property_invitations i join public.properties p on p.id=i.property_id join public.users u on u.id=i.actor_id where i.email=any(p_emails) and i.status='sent' and i.expires_at>clock_timestamp() and private.people_access(i.property_id,i.actor_id)),'[]');
end $$;
create function public.bloom_property_invite_accept(p_id uuid,p_subject text,p_emails text[],p_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.property_invitations;u public.users;pid uuid;begin
 perform private.people_service();
 if p_subject is null or length(p_subject) not between 1 and 200 or p_name is null or length(p_name) not between 1 and 100 or cardinality(p_emails)>100 then raise exception 'VALIDATION_ERROR';end if;
 select property_id into pid from private.property_invitations where id=p_id;
 perform 1 from public.properties where id=pid for update;
 select * into i from private.property_invitations where id=p_id for update;
 if i.id is null or not coalesce(i.email=any(p_emails),false) or not private.people_access(i.property_id,i.actor_id) then raise exception 'NOT_FOUND';end if;
 if i.status not in ('sent','accepted') or (i.status<>'accepted' and i.expires_at<=clock_timestamp()) then raise exception 'INVALID_STATE';end if;
 perform pg_advisory_xact_lock(hashtextextended('property-invite-subject:'||p_subject,0));
 select * into u from public.users where clerk_user_id=p_subject for update;
 if u.id is not null and u.role<>'owner' then raise exception 'FORBIDDEN';end if;
 if i.status='accepted' then
  if i.accepted_by is distinct from u.id then raise exception 'NOT_FOUND';end if;
  return jsonb_build_object('propertyId',i.property_id,'role',u.role);
 end if;
 if u.id is null then
  insert into public.users(clerk_user_id,role,display_name) values(p_subject,'owner',p_name) on conflict(clerk_user_id) do nothing;
  select * into u from public.users where clerk_user_id=p_subject for update;
  if u.role<>'owner' then raise exception 'FORBIDDEN';end if;
 end if;
 insert into public.property_owners(property_id,owner_id) values(i.property_id,u.id) on conflict do nothing;
 update private.property_invitations set status='accepted',accepted_by=u.id,accepted_at=clock_timestamp() where id=i.id;
 return jsonb_build_object('propertyId',i.property_id,'role',u.role);
end $$;
revoke all on function public.bloom_property_people(uuid),public.bloom_property_invite(uuid,text,text) from public,anon,service_role;
grant execute on function public.bloom_property_people(uuid),public.bloom_property_invite(uuid,text,text) to authenticated;
revoke all on function public.bloom_property_invite_delivery(uuid,uuid,uuid,text),public.bloom_property_invites_incoming(text[]),public.bloom_property_invite_accept(uuid,text,text[],text) from public,anon,authenticated;
grant execute on function public.bloom_property_invite_delivery(uuid,uuid,uuid,text),public.bloom_property_invites_incoming(text[]),public.bloom_property_invite_accept(uuid,text,text[],text) to service_role;
commit;
