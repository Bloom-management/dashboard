-- Contract-v1 tables only. Reconciliation RPC signature awaits calendar/main handshake.
begin;
create table public.calendar_sources (
 id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties,provider text not null check(provider in ('airbnb','vrbo')),
 encrypted_url text not null,enabled boolean not null default true,last_success_at timestamptz,etag text,last_modified text,sync_version bigint not null default 0,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.calendar_sync_runs (
 id uuid primary key default gen_random_uuid(),source_id uuid not null references public.calendar_sources,status text not null check(status in ('running','success','failed','not_modified')),
 counts jsonb not null default '{}',error_code text,started_at timestamptz not null default now(),completed_at timestamptz
);
create table public.calendar_events (
 id uuid primary key default gen_random_uuid(),source_id uuid not null references public.calendar_sources,uid text not null,recurrence_key text not null default '',
 start_local_date date not null,end_local_date date not null,kind text not null check(kind in ('reservation','blocked','unknown')),content_hash text not null,
 source_status text not null default 'active' check(source_status in ('active','removed')),last_seen_run_id uuid references public.calendar_sync_runs,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(source_id,uid,recurrence_key),check(end_local_date>=start_local_date)
);
create table public.calendar_event_history(id uuid primary key default gen_random_uuid(),event_id uuid not null references public.calendar_events,run_id uuid references public.calendar_sync_runs,before_snapshot jsonb not null,after_snapshot jsonb not null,created_at timestamptz not null default now());
create table public.job_events(job_id uuid references public.jobs,event_id uuid references public.calendar_events,primary key(job_id,event_id));
create table public.calendar_changes (
 id uuid primary key default gen_random_uuid(),event_id uuid not null references public.calendar_events,job_id uuid references public.jobs,
 type text not null check(type in ('changed','removed','conflict')),before_start_date date,before_end_date date,after_start_date date,after_end_date date,
 acknowledged_at timestamptz,acknowledged_by uuid references public.users,created_at timestamptz not null default now()
);
create trigger calendar_history_immutable before update or delete on public.calendar_event_history for each row execute function private.immutable();
do $$ declare t text;begin foreach t in array array['calendar_sources','calendar_sync_runs','calendar_events','calendar_event_history','job_events','calendar_changes'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);end loop;end $$;
-- All owner calendar fields are explicitly allowlisted, including notices.
create function public.bloom_owner_calendar(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u public.users;begin
 u:=private.require_actor('owner');if p_from is null or p_to is null or p_to<p_from or p_to-p_from>92 then raise exception 'VALIDATION_ERROR';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'propertyId',p.id,'propertyName',p.name,'timezone',p.timezone,
 'startDate',e.start_local_date,'endDate',e.end_local_date,'providers',jsonb_build_array(s.provider),'kind',e.kind,'removed',e.source_status='removed',
 'changes',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'type',c.type,'message',case c.type when 'removed' then 'Calendar block removed.' when 'changed' then 'Calendar dates changed.' else 'Calendar dates need review.' end,'acknowledged',c.acknowledged_at is not null) order by c.created_at,c.id),'[]') from public.calendar_changes c where c.event_id=e.id)) order by e.start_local_date,e.id),'[]')
 from public.calendar_events e join public.calendar_sources s on s.id=e.source_id join public.properties p on p.id=s.property_id
 where exists(select 1 from public.property_owners po where po.property_id=p.id and po.owner_id=u.id)
 and e.start_local_date<=p_to and e.end_local_date>=p_from);end $$;
create function private.job_changes(p_job uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'type',c.type,'message',case c.type when 'removed' then 'Calendar block removed.' when 'changed' then 'Calendar dates changed.' else 'Calendar dates need review.' end,'acknowledged',c.acknowledged_at is not null) order by c.created_at,c.id),'[]') from public.calendar_changes c where c.job_id=p_job
$$;
-- Extend the DTO without exposing raw events, feed URLs or cleaner identities.
alter function private.job_dto(uuid) rename to job_dto_base;
create function private.job_dto(p_job uuid) returns jsonb language sql stable security definer set search_path='' as $$ select private.job_dto_base(p_job)||jsonb_build_object('changes',private.job_changes(p_job)) $$;
-- Entry policy uses a definer helper rather than an RLS-denied jobs subquery.
create function private.entry_access(p_property uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_admin() or exists(select 1 from public.assignments a join public.jobs j on j.id=a.job_id where j.property_id=p_property and a.cleaner_id=(private.actor()).id and a.ended_at is null and j.status='open')
$$;
drop policy instructions_read on public.property_entry_instructions;
create policy instructions_read on public.property_entry_instructions for select to authenticated using(private.entry_access(property_id));
-- Signing is server-only: SELECT would allow callers to request their own arbitrary TTL.
drop policy bloom_photo_read on storage.objects;
revoke all on function public.bloom_owner_calendar(date,date) from public,anon;
grant execute on function public.bloom_owner_calendar(date,date) to authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.actor(),private.is_admin(),private.assigned(uuid),private.photo_access(uuid,boolean),private.storage_upload(text),private.entry_access(uuid) to authenticated;
-- Service credentials remain server-only and never used for ordinary user queries.
grant usage on schema public to service_role;
grant select on public.job_photos to service_role;
commit;
