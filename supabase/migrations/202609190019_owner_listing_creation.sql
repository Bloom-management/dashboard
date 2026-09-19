begin;
alter table public.properties add column owner_created boolean not null default false,
 add column bedroom_count integer check(bedroom_count between 0 and 20),
 add column bathroom_count integer check(bathroom_count between 0 and 20);
alter table public.jobs add column setup_required boolean not null default false;
create function private.owner_setup_job() returns trigger language plpgsql security definer set search_path='' as $$ begin
 select owner_created and cleaning_config is null into new.setup_required from public.properties where id=new.property_id;
 return new;end $$;
create trigger owner_setup_snapshot before insert on public.jobs for each row execute function private.owner_setup_job();
create function private.owner_setup_assignment() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.ended_at is null and exists(select 1 from public.jobs where id=new.job_id and setup_required) then raise exception 'REVIEW_REQUIRED';end if;
 return new;end $$;
create trigger owner_setup_assignment before insert or update on public.assignments for each row execute function private.owner_setup_assignment();
create policy jobs_owner_setup_hidden on public.jobs as restrictive for select to authenticated using(not setup_required or private.is_admin());
create function private.owner_setup_configured() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if new.owner_created and new.cleaning_config is not null then
 perform 1 from public.jobs where property_id=new.id and setup_required order by id for update;
 update public.jobs set setup_required=false,cleaning_config=coalesce(cleaning_config,new.cleaning_config),version=version+1,updated_at=clock_timestamp() where property_id=new.id and setup_required and status<>'completed';
 end if;return new;end $$;
create trigger owner_setup_configured after update of cleaning_config on public.properties for each row execute function private.owner_setup_configured();
revoke all on function private.owner_setup_job(),private.owner_setup_assignment(),private.owner_setup_configured() from public,anon,authenticated,service_role;
create or replace function public.bloom_owner_listings(p_cursor uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u public.users;r jsonb;begin
 u:=private.require_actor('owner');
 with page as (select p.* from public.properties p join public.property_owners po on po.property_id=p.id where p.deleted_at is null and po.owner_id=u.id and (p_cursor is null or p.id>p_cursor) order by p.id limit 101),
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
create or replace function public.bloom_admin_property_options(p_id uuid default null,p_cursor uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.require_actor('admin');
 with page as (select p.* from public.properties p where p.deleted_at is null and (p_id is null or p.id=p_id) and (p_cursor is null or p.id>p_cursor) order by p.id limit 101),
 shown as (select * from page order by id limit 100)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
 'setupRequired',p.owner_created and p.cleaning_config is null,'bedroomCount',p.bedroom_count,'bathroomCount',p.bathroom_count,'id',p.id,'name',p.name,'cityId',p.city_id,'timezone',p.timezone,'address',p.address,'isBloomOwned',p.is_bloom_owned,'active',p.active,
 'soloRateCents',p.solo_rate_cents,'instructions',coalesce((select instructions from public.property_entry_instructions where property_id=p.id),''),
 'pendingOwnerEmail',(select email from private.pending_property_owners where property_id=p.id and claimed_by is null),
 'ownerIds',coalesce((select jsonb_agg(owner_id order by owner_id) from public.property_owners where property_id=p.id),'[]'::jsonb)) order by p.id) from shown p),'[]'::jsonb),
 'nextCursor',case when (select count(*) from page)>100 then (select max(id::text) from shown) else null end) into result;
 return result;
end $$;
create or replace function public.bloom_jobs(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u public.users;begin u:=private.require_actor();if u.role='owner' then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>92 then raise exception 'VALIDATION_ERROR';end if;
 return (select coalesce(jsonb_agg(private.job_dto(j.id) order by j.start_at,j.id),'[]') from public.jobs j join public.properties p on p.id=j.property_id where (not j.setup_required or u.role='admin') and j.checkout_date between p_from and p_to and (u.role='admin' or p.city_id=u.approved_city_id or private.assigned(j.id)));end $$;
create function public.bloom_owner_listing_create(p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;r jsonb;pid uuid;v text;n numeric;listing jsonb;begin
 u:=private.require_actor('owner');
 r:=private.receipt('owner_listing_create',p_key,p_input);if r is not null then return r;end if;
 -- Match property-owner insertion's user lock; acquiring a shared lock first would deadlock on upgrade.
 perform 1 from public.users where id=u.id and role='owner' for update;if not found then raise exception 'FORBIDDEN';end if;
 if p_input is null or jsonb_typeof(p_input)<>'object' or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('name','address','cityId','timezone','bedroomCount','bathroomCount')) then raise exception 'VALIDATION_ERROR';end if;
 if jsonb_typeof(p_input->'name') is distinct from 'string' or length(trim(p_input->>'name')) not between 1 and 200
 or jsonb_typeof(p_input->'address') is distinct from 'string' or length(trim(p_input->>'address')) not between 1 and 500
 or jsonb_typeof(p_input->'timezone') is distinct from 'string' or not exists(select 1 from pg_timezone_names where name=p_input->>'timezone')
 or jsonb_typeof(p_input->'cityId') is distinct from 'string' then raise exception 'VALIDATION_ERROR';end if;
 foreach v in array array['bedroomCount','bathroomCount'] loop
 if jsonb_typeof(p_input->v) is distinct from 'number' then raise exception 'VALIDATION_ERROR';end if;
 n:=(p_input->>v)::numeric;if n<>trunc(n) or n not between 0 and 20 then raise exception 'VALIDATION_ERROR';end if;
 end loop;
 perform 1 from public.cities where id=(p_input->>'cityId')::uuid and active for share;
 if not found then raise exception 'VALIDATION_ERROR';end if;
 insert into public.properties(city_id,name,address,timezone,is_bloom_owned,owner_created,bedroom_count,bathroom_count)
 values((p_input->>'cityId')::uuid,trim(p_input->>'name'),trim(p_input->>'address'),p_input->>'timezone',false,true,((p_input->>'bedroomCount')::numeric)::integer,((p_input->>'bathroomCount')::numeric)::integer) returning id into pid;
 insert into public.property_owners(property_id,owner_id) values(pid,u.id);
 -- Creation response is the same safe shape as owner listings, independent of pagination.
 listing:=jsonb_build_object('id',pid,'name',trim(p_input->>'name'),'timezone',p_input->>'timezone','active',true,'setupRequired',true,
 'bedroomCount',((p_input->>'bedroomCount')::numeric)::integer,'bathroomCount',((p_input->>'bathroomCount')::numeric)::integer,
 'supplies','[]'::jsonb,'sources','[]'::jsonb,'nightlyGuestRateCents',null,'hostPayoutCents',null,'currency','USD');
 return private.save_receipt('owner_listing_create',p_key,p_input,jsonb_build_object('listing',listing));
end $$;
revoke all on function public.bloom_owner_listing_create(jsonb,text) from public,anon,service_role;
grant execute on function public.bloom_owner_listing_create(jsonb,text) to authenticated;
commit;
