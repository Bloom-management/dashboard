begin;
-- Empty by default. Trusted local fixtures alone allowlist exact job/window pairs.
-- No application role, API, or editable metadata can configure this exception.
create table private.practice_window_exceptions (
 job_id uuid primary key references public.jobs deferrable initially deferred,
 property_id uuid not null references public.properties,
 start_at timestamptz not null,
 end_at timestamptz not null,
 check(end_at > start_at)
);
revoke all on private.practice_window_exceptions from public,anon,authenticated,service_role;
create or replace function private.guard_job() returns trigger
language plpgsql set search_path='' as $$ begin
 if TG_OP='DELETE' then raise exception 'INVALID_STATE';end if;
 if TG_OP='UPDATE' and old.status='completed' and new is distinct from old then raise exception 'INVALID_STATE';end if;
 if not exists(select 1 from pg_timezone_names where name=new.timezone_snapshot) then raise exception 'VALIDATION_ERROR';end if;
 if new.start_at is distinct from ((new.checkout_date+time '11:00') at time zone new.timezone_snapshot)
 or new.end_at is distinct from ((new.checkout_date+time '15:00') at time zone new.timezone_snapshot) then
  if not exists(select 1 from private.practice_window_exceptions e
   where e.job_id=new.id and e.property_id=new.property_id
   and e.start_at=new.start_at and e.end_at=new.end_at
   and (e.start_at at time zone new.timezone_snapshot)::date=new.checkout_date
   and (e.end_at at time zone new.timezone_snapshot)::date=new.checkout_date)
  then raise exception 'VALIDATION_ERROR';end if;
 end if;
 return new;
end $$;
commit;
