\set ON_ERROR_STOP on
begin;
do $$
declare actor public.users; result jsonb;begin
 select * into actor from public.users where role='cleaner' and onboarding_completed_at is not null limit 1;
 if actor.id is null then raise exception 'Local cleaner fixture required';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.clerk_user_id)::text,true);
 update public.users set bloom_network_enabled=false where id=actor.id;
 delete from private.notification_dismissals where user_id=actor.id and notification_key='network:opportunities';
 if not exists(select 1 from private.inbox_items() where id='network:opportunities' and dismissible and href='/cleaner?network=1') then raise exception 'Network reminder missing';end if;
 perform public.bloom_notification_dismiss('network:opportunities');
 if exists(select 1 from jsonb_array_elements(public.bloom_notification_inbox(0)->'items') i where i->>'id'='network:opportunities') then raise exception 'Dismissed reminder visible';end if;
 update public.users set bloom_network_enabled=true where id=actor.id;
 if exists(select 1 from private.inbox_items() where id='network:opportunities') then raise exception 'Enabled cleaner still prompted';end if;
 update public.users set role='owner',bloom_network_enabled=false where id=actor.id;
 if exists(select 1 from private.inbox_items() where id='network:opportunities') then raise exception 'Owner prompted';end if;
 raise notice 'Network reminder eligibility and durable dismissal passed';
end $$;
rollback;
