-- Run only against an explicitly selected LOCAL development database as its trusted owner.
-- No public RPC or signup path can invoke this procedure. Never commit the supplied subject.
\set ON_ERROR_STOP on
\prompt 'Verified development Clerk user ID: ' clerk_subject
begin;
lock table public.users in exclusive mode;
do $$ begin
 if exists(select 1 from public.users where role='admin') then raise exception 'Initial admin already exists; use authenticated admin role grants';end if;
end $$;
insert into public.users(clerk_user_id,role,display_name) values (:'clerk_subject','admin','')
on conflict(clerk_user_id) do update set role='admin',updated_at=clock_timestamp();
commit;
