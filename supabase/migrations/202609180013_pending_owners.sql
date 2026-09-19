begin;
create table private.pending_property_owners (
 property_id uuid primary key references public.properties,
 email text not null, created_by uuid not null references public.users,
 created_at timestamptz not null default now(),claimed_by uuid references public.users,claimed_at timestamptz,
 check ((claimed_by is null)=(claimed_at is null))
);
alter table private.pending_property_owners enable row level security;
revoke all on private.pending_property_owners from public,anon,authenticated,service_role;
create index pending_owner_email on private.pending_property_owners(email) where claimed_by is null;
create or replace function public.bloom_admin_property(p_data jsonb,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb;pid uuid;oid uuid;bloom boolean;rate numeric;pending text;
begin
 perform private.require_actor('admin');
 r:=private.receipt('admin_property',p_key,p_data);if r is not null then return r;end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('cityId','name','timezone','address','instructions','isBloomOwned','soloRateCents','ownerIds','pendingOwnerEmail')) then raise exception 'VALIDATION_ERROR';end if;
 if jsonb_typeof(p_data->'isBloomOwned') is distinct from 'boolean' or jsonb_typeof(p_data->'ownerIds') is distinct from 'array' or jsonb_typeof(p_data->'soloRateCents') is distinct from 'number' then raise exception 'VALIDATION_ERROR';end if;
 if jsonb_typeof(p_data->'name') is distinct from 'string' or length(trim(p_data->>'name')) not between 1 and 200
 or jsonb_typeof(p_data->'address') is distinct from 'string' or length(trim(p_data->>'address')) not between 1 and 500
 or jsonb_typeof(p_data->'timezone') is distinct from 'string' or length(p_data->>'timezone') not between 1 and 100
 or jsonb_typeof(p_data->'instructions') is distinct from 'string' or length(trim(p_data->>'instructions')) not between 1 and 5000 then raise exception 'VALIDATION_ERROR';end if;
 pending:=nullif(lower(trim(p_data->>'pendingOwnerEmail')),'');
 if p_data ? 'pendingOwnerEmail' and jsonb_typeof(p_data->'pendingOwnerEmail') not in ('string','null') then raise exception 'VALIDATION_ERROR';end if;
 if pending is not null and (length(pending)>254 or pending !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then raise exception 'VALIDATION_ERROR';end if;
 bloom:=(p_data->>'isBloomOwned')::boolean;rate:=(p_data->>'soloRateCents')::numeric;
 if rate<>trunc(rate) or rate not between 2 and 2147483646 or mod(rate,2)<>0 then raise exception 'VALIDATION_ERROR';end if;
 if jsonb_array_length(p_data->'ownerIds')>100 or (bloom and (jsonb_array_length(p_data->'ownerIds')<>0 or pending is not null)) or (not bloom and ((jsonb_array_length(p_data->'ownerIds')=0 and pending is null) or (jsonb_array_length(p_data->'ownerIds')>0 and pending is not null))) then raise exception 'VALIDATION_ERROR';end if;
 if exists(select 1 from jsonb_array_elements(p_data->'ownerIds') v where jsonb_typeof(v)<>'string') then raise exception 'VALIDATION_ERROR';end if;
 if not exists(select 1 from public.cities where id=(p_data->>'cityId')::uuid and active) then raise exception 'VALIDATION_ERROR';end if;
 for oid in select distinct value::uuid from jsonb_array_elements_text(p_data->'ownerIds') order by 1 loop
  perform 1 from public.users where id=oid and role='owner' for update;if not found then raise exception 'VALIDATION_ERROR';end if;
 end loop;
 insert into public.properties(city_id,name,timezone,address,is_bloom_owned,solo_rate_cents)
 values((p_data->>'cityId')::uuid,trim(p_data->>'name'),p_data->>'timezone',trim(p_data->>'address'),bloom,rate::integer) returning id into pid;
 insert into public.property_entry_instructions(property_id,instructions) values(pid,trim(p_data->>'instructions'));
 insert into public.property_owners(property_id,owner_id) select pid,value::uuid from jsonb_array_elements_text(p_data->'ownerIds');
 if pending is not null then insert into private.pending_property_owners(property_id,email,created_by) values(pid,pending,(private.actor()).id);end if;
 select to_jsonb(p) into r from public.properties p where id=pid;
 return private.save_receipt('admin_property',p_key,p_data,r);
end $$;
revoke all on function public.bloom_admin_property(jsonb,text) from public,anon;
grant execute on function public.bloom_admin_property(jsonb,text) to authenticated;

create or replace function public.bloom_admin_property_options(p_id uuid default null,p_cursor uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.require_actor('admin');
 with page as (select p.* from public.properties p where (p_id is null or p.id=p_id) and (p_cursor is null or p.id>p_cursor) order by p.id limit 101),
 shown as (select * from page order by id limit 100)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
 'id',p.id,'name',p.name,'cityId',p.city_id,'timezone',p.timezone,'address',p.address,'isBloomOwned',p.is_bloom_owned,'active',p.active,
 'soloRateCents',p.solo_rate_cents,'instructions',coalesce((select instructions from public.property_entry_instructions where property_id=p.id),''),
 'pendingOwnerEmail',(select email from private.pending_property_owners where property_id=p.id and claimed_by is null),
 'ownerIds',coalesce((select jsonb_agg(owner_id order by owner_id) from public.property_owners where property_id=p.id),'[]'::jsonb)) order by p.id) from shown p),'[]'::jsonb),
 'nextCursor',case when (select count(*) from page)>100 then (select max(id::text) from shown) else null end) into result;
 return result;
end $$;
revoke all on function public.bloom_admin_property_options(uuid,uuid) from public,anon;
grant execute on function public.bloom_admin_property_options(uuid,uuid) to authenticated;

-- Only the server with a verified Clerk primary email can call this provisioning port.
create function public.bloom_claim_pending_owner(p_subject text,p_email text,p_display_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.users;mail text;row private.pending_property_owners;begin
 perform private.calendar_actor(null);
 mail:=lower(trim(p_email));
 if p_subject is null or length(p_subject) not between 1 and 200 or mail is null or length(mail)>254 or mail !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 or p_display_name is null or length(trim(p_display_name)) not between 1 and 100 or p_display_name ~ '[[:cntrl:]]' then raise exception 'VALIDATION_ERROR';end if;
 -- Same identity lock as ordinary onboarding prevents concurrent cleaner/owner provisioning.
 perform pg_advisory_xact_lock(hashtextextended('onboard:'||p_subject,0));
 perform pg_advisory_xact_lock(hashtextextended('pending-owner:'||mail,0));
 select * into u from public.users where clerk_user_id=p_subject for update;
 if u.id is not null and u.role<>'owner' then raise exception 'CONFLICT';end if;
 if not exists(select 1 from private.pending_property_owners where email=mail and claimed_by is null) then
  if u.id is null then return null;end if;
 else
  if u.id is null then insert into public.users(clerk_user_id,role,display_name) values(p_subject,'owner',trim(p_display_name)) returning * into u;end if;
  for row in select * from private.pending_property_owners where email=mail and claimed_by is null order by property_id for update loop
   insert into public.property_owners(property_id,owner_id) values(row.property_id,u.id) on conflict do nothing;
   update private.pending_property_owners set claimed_by=u.id,claimed_at=clock_timestamp() where property_id=row.property_id;
  end loop;
 end if;
 return jsonb_build_object('id',u.id,'role',u.role,'displayName',u.display_name,'approvedCityId',u.approved_city_id);
end $$;
revoke all on function public.bloom_claim_pending_owner(text,text,text) from public,anon,authenticated;
grant execute on function public.bloom_claim_pending_owner(text,text,text) to service_role;
commit;
