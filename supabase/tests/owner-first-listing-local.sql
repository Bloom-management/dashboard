\set ON_ERROR_STOP on
begin;
do $$
declare actor public.users;pid uuid;begin
 insert into public.users(clerk_user_id,role,display_name,onboarding_completed_at) values('local-first-listing-'||gen_random_uuid(),'owner','LOCAL TEST first listing',now()) returning * into actor;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.clerk_user_id)::text,true);
 if not exists(select 1 from jsonb_array_elements(public.bloom_notification_inbox(0)->'items') n where n->>'body'='Add your first listing' and n->>'href'='/owner?view=listings&create=1') then raise exception 'Owner reminder missing';end if;
 select id into pid from public.properties where deleted_at is null limit 1;
 if pid is null then raise exception 'Local property fixture required';end if;
 insert into public.property_owners(property_id,owner_id) values(pid,actor.id);
 if exists(select 1 from private.inbox_items() where id='owner:first-listing') then raise exception 'Reminder remains for existing owner';end if;
 update public.users set role='cleaner' where id=actor.id;
 if exists(select 1 from private.inbox_items() where id='owner:first-listing') then raise exception 'Owner reminder leaked to cleaner';end if;
 raise notice 'Owner first listing eligibility, destination, and resolution passed';
end $$;
rollback;
