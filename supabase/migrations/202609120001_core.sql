begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
create type public.bloom_role as enum ('admin','owner','cleaner');
create table public.cities (id uuid primary key default gen_random_uuid(), name text not null unique, active boolean not null default true);
insert into public.cities(id,name) values ('00000000-0000-4000-8000-000000000001','Detroit');
create table public.users (
 id uuid primary key default gen_random_uuid(), clerk_user_id text not null unique check(length(clerk_user_id)>0),
 role public.bloom_role not null default 'cleaner', display_name text not null default '', approved_city_id uuid references public.cities,
 initial_city_selected_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.city_change_requests (
 id uuid primary key default gen_random_uuid(), cleaner_id uuid not null references public.users, requested_city_id uuid not null references public.cities,
 status text not null default 'pending' check(status in ('pending','approved','rejected')), resolved_by uuid references public.users, resolved_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index one_pending_city on public.city_change_requests(cleaner_id) where status='pending';
create table public.properties (
 id uuid primary key default gen_random_uuid(), city_id uuid not null references public.cities, name text not null, timezone text not null default 'America/Detroit',
 address text not null, is_bloom_owned boolean not null default false, solo_rate_cents integer not null default 7500 check(solo_rate_cents>0 and solo_rate_cents%2=0), active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.property_owners(property_id uuid references public.properties,owner_id uuid references public.users,primary key(property_id,owner_id));
create table public.property_entry_instructions(property_id uuid primary key references public.properties, instructions text not null, updated_at timestamptz not null default now());
create table public.jobs (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties, checkout_date date not null,
 start_at timestamptz not null, end_at timestamptz not null, timezone_snapshot text not null, solo_rate_cents_snapshot integer not null check(solo_rate_cents_snapshot>0 and solo_rate_cents_snapshot%2=0),
 status text not null default 'open' check(status in ('open','completed','cancelled')),review_required boolean not null default false,version integer not null default 1,
 completed_at timestamptz,completed_by uuid references public.users,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(property_id,checkout_date),check(end_at>start_at),check((status='completed')=(completed_at is not null and completed_by is not null))
);
create table public.assignments (
 id uuid primary key default gen_random_uuid(),job_id uuid not null references public.jobs,cleaner_id uuid not null references public.users,slot smallint not null check(slot in (1,2)),
 claimed_at timestamptz not null default now(),ended_at timestamptz,end_reason text check(end_reason in ('withdrawn','reassigned','cancelled')),
 completed_pay_cents integer check(completed_pay_cents>0),check((ended_at is null)=(end_reason is null))
);
create unique index active_slot on public.assignments(job_id,slot) where ended_at is null;
create unique index active_cleaner on public.assignments(job_id,cleaner_id) where ended_at is null;
create table public.job_history(id uuid primary key default gen_random_uuid(),job_id uuid not null references public.jobs,actor_id uuid references public.users,action text not null,before_snapshot jsonb,after_snapshot jsonb,created_at timestamptz not null default now(),request_id text not null);
create table public.job_photos (
 id uuid primary key default gen_random_uuid(),job_id uuid not null references public.jobs,uploader_id uuid not null references public.users,
 category text not null check(category in ('bedrooms','bathrooms','kitchen','living_room')),object_path text not null unique,
 state text not null default 'pending' check(state in ('pending','ready')),bytes integer not null check(bytes between 1 and 10485760),
 mime text not null check(mime in ('image/jpeg','image/png','image/webp')),created_at timestamptz not null default now()
);
create table public.operation_receipts(actor_id uuid not null references public.users,operation text not null,idempotency_key text not null check(length(idempotency_key) between 1 and 200),input_hash text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(actor_id,operation,idempotency_key));

create function private.actor() returns public.users language sql stable security definer set search_path='' as $$ select u from public.users u where u.clerk_user_id=auth.jwt()->>'sub' $$;
create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$ select coalesce((private.actor()).role='admin',false) $$;
create function private.assigned(p_job uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.assignments where job_id=p_job and cleaner_id=(private.actor()).id and ended_at is null) $$;
create function private.photo_access(p_job uuid,p_write boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.jobs j where j.id=p_job and
 (case when p_write then j.status='open' and not j.review_required and private.assigned(j.id)
 else private.is_admin() or private.assigned(j.id) end))
$$;
create function private.require_actor(p_role public.bloom_role default null) returns public.users language plpgsql stable security definer set search_path='' as $$
declare u public.users; begin u:=private.actor(); if u.id is null then raise exception 'UNAUTHENTICATED'; end if;
 if p_role is not null and u.role<>p_role then raise exception 'FORBIDDEN'; end if; return u; end $$;
create function private.withdrawal_allowed(p_now timestamptz,p_start timestamptz) returns boolean language sql immutable set search_path='' as $$ select p_now <= p_start - interval '6 hours' $$;
create function private.audit(p_job uuid,p_action text,p_before jsonb,p_key text,p_context jsonb default '{}'::jsonb) returns void language sql security definer set search_path='' as $$
 insert into public.job_history(job_id,actor_id,action,before_snapshot,after_snapshot,request_id)
 select p_job,(private.actor()).id,p_action,p_before,jsonb_build_object('context',p_context,'job',to_jsonb(j),'assignments',(select coalesce(jsonb_agg(a order by a.slot),'[]') from public.assignments a where a.job_id=p_job)),p_key from public.jobs j where id=p_job
$$;
create function private.job_snapshot(p_job uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('job',to_jsonb(j),'assignments',(select coalesce(jsonb_agg(a order by a.slot),'[]') from public.assignments a where a.job_id=p_job)) from public.jobs j where id=p_job
$$;
create function private.receipt(p_operation text,p_key text,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.operation_receipts; u public.users; begin
 u:=private.require_actor(); if p_key is null or length(p_key) not between 1 and 200 then raise exception 'VALIDATION_ERROR'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u.id::text||':'||p_operation||':'||p_key,0));
 select * into r from public.operation_receipts where actor_id=u.id and operation=p_operation and idempotency_key=p_key;
 if found then if r.input_hash<>p_input::text then raise exception 'CONFLICT'; end if; return r.result; end if;return null; end $$;
create function private.save_receipt(p_operation text,p_key text,p_input jsonb,p_result jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin
 insert into public.operation_receipts(actor_id,operation,idempotency_key,input_hash,result) values((private.actor()).id,p_operation,p_key,p_input::text,p_result);return p_result;end $$;

-- No client table writes: all state transitions go through actor-checking RPCs.
do $$ declare t text; begin foreach t in array array['cities','users','city_change_requests','properties','property_owners','property_entry_instructions','jobs','assignments','job_history','job_photos','operation_receipts'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 end loop; end $$;
grant select on public.cities,public.users,public.city_change_requests,public.property_owners,public.property_entry_instructions,public.assignments,public.job_photos to authenticated;
-- Rate columns and other internal job state are available only through sanitized RPCs.
grant select(id,city_id,name,timezone,address,is_bloom_owned,active,created_at,updated_at) on public.properties to authenticated;
create policy cities_read on public.cities for select to authenticated using(active or private.is_admin());
create policy self_read on public.users for select to authenticated using(id=(private.actor()).id or private.is_admin());
create policy city_requests_read on public.city_change_requests for select to authenticated using(cleaner_id=(private.actor()).id or private.is_admin());
create policy owners_read on public.property_owners for select to authenticated using(owner_id=(private.actor()).id or private.is_admin());
create policy properties_read on public.properties for select to authenticated using(private.is_admin() or exists(select 1 from public.property_owners po where po.property_id=id and po.owner_id=(private.actor()).id));
create policy assignments_read on public.assignments for select to authenticated using(private.is_admin() or cleaner_id=(private.actor()).id);
create policy instructions_read on public.property_entry_instructions for select to authenticated using(private.is_admin() or exists(select 1 from public.assignments a join public.jobs j on j.id=a.job_id where j.property_id=property_entry_instructions.property_id and a.cleaner_id=(private.actor()).id and a.ended_at is null and j.status='open'));
create policy photos_read on public.job_photos for select to authenticated using(private.photo_access(job_id));
-- Helpers are not exposed as Data API RPCs; revoke the default PUBLIC function grant.
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.actor(),private.is_admin(),private.assigned(uuid),private.photo_access(uuid,boolean) to authenticated;
commit;
