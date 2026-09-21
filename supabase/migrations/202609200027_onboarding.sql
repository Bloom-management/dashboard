begin;
alter table public.users add column home_base text check(home_base is null or length(trim(home_base)) between 1 and 100),add column onboarding_completed_at timestamptz;
-- Explicit grandfathering of working accounts only; subsequent inserts remain incomplete.
update public.users set onboarding_completed_at=clock_timestamp() where role in ('owner','admin') or (role='cleaner' and approved_city_id is not null and initial_city_selected_at is not null);
create function private.onboarding_ready() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.users where clerk_user_id=auth.jwt()->>'sub' and (role='admin' or onboarding_completed_at is not null))
$$;
revoke all on function private.onboarding_ready() from public,anon;grant execute on function private.onboarding_ready() to authenticated;
create or replace function private.require_actor(p_role public.bloom_role default null) returns public.users language plpgsql stable security definer set search_path='' as $$
declare u public.users;begin u:=private.actor();if u.id is null then raise exception 'UNAUTHENTICATED';end if;
 if u.role<>'admin' and u.onboarding_completed_at is null then raise exception 'INVALID_STATE';end if;
 if p_role is not null and u.role<>p_role then raise exception 'FORBIDDEN';end if;return u;end $$;
-- All ordinary application reads/storage authorization remain unavailable until completion.
do $$declare t record;begin for t in select tablename from pg_tables where schemaname='public' and tablename<>'cities' loop
 execute format('create policy onboarding_complete on public.%I as restrictive for all to authenticated using (private.onboarding_ready()) with check (private.onboarding_ready())',t.tablename);
end loop;end $$;
create policy onboarding_complete on storage.objects as restrictive for all to authenticated using(private.onboarding_ready()) with check(private.onboarding_ready());
create function public.bloom_onboarding_profile() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u public.users;begin
 if coalesce(auth.jwt()->>'sub','')='' then raise exception 'UNAUTHENTICATED';end if;
 select * into u from public.users where clerk_user_id=auth.jwt()->>'sub';if not found then return null;end if;
 return jsonb_build_object('id',u.id,'role',u.role,'displayName',u.display_name,'cityId',u.approved_city_id,'homeBase',u.home_base,'complete',u.role='admin' or u.onboarding_completed_at is not null,'assignedPropertyCount',(select count(*) from public.property_owners po join public.properties p on p.id=po.property_id where po.owner_id=u.id and p.deleted_at is null));end $$;
revoke all on function public.bloom_onboarding_profile() from public,anon,service_role;grant execute on function public.bloom_onboarding_profile() to authenticated;
create function public.bloom_onboarding_evidence(p_subject text,p_primary_email text,p_emails text[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform private.people_service();
 if coalesce(length(p_subject),0) not between 1 and 200 or p_emails is null or cardinality(p_emails)>100 then raise exception 'VALIDATION_ERROR';end if;
 return jsonb_build_object('pendingOwnerCount',(select count(*) from private.pending_property_owners x join public.properties p on p.id=x.property_id where x.email=p_primary_email and x.claimed_by is null and p.deleted_at is null),
 'propertyInvitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'status',case when not private.people_access(i.property_id,i.actor_id) then 'invalid' when i.status='accepted' and i.accepted_by=(select id from public.users where clerk_user_id=p_subject) then 'valid' when i.status='sent' and i.expires_at>clock_timestamp() then 'valid' when i.status='expired' or i.expires_at<=clock_timestamp() then 'expired' else 'invalid' end)) from private.property_invitations i where i.email=any(p_emails)),'[]'::jsonb));end $$;
revoke all on function public.bloom_onboarding_evidence(text,text,text[]) from public,anon,authenticated;grant execute on function public.bloom_onboarding_evidence(text,text,text[]) to service_role;
create table private.onboarding_receipts(subject text not null,idempotency_key text not null,input jsonb not null,result jsonb not null,primary key(subject,idempotency_key));
alter table private.onboarding_receipts enable row level security;revoke all on private.onboarding_receipts from public,anon,authenticated,service_role;
create function public.bloom_complete_onboarding(p_subject text,p_role text,p_city uuid,p_home_base text,p_name text,p_primary_email text,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;r private.onboarding_receipts;i jsonb;result jsonb;x private.pending_property_owners;begin
 perform private.people_service();
 if coalesce(length(p_subject),0) not between 1 and 200 or p_role is null or p_role not in ('owner','cleaner') or coalesce(length(p_key),0) not between 1 and 200 or coalesce(length(trim(p_name)),0) not between 1 and 100 then raise exception 'VALIDATION_ERROR';end if;
 if p_role='cleaner' and (p_city is null or p_home_base is not null) then raise exception 'VALIDATION_ERROR';end if;
 if p_role='owner' and (p_city is not null or coalesce(length(trim(p_home_base)),0) not between 1 and 100) then raise exception 'VALIDATION_ERROR';end if;
 perform pg_advisory_xact_lock(hashtextextended('onboard:'||p_subject,0));
 i:=jsonb_build_object('role',p_role,'cityId',p_city,'homeBase',p_home_base);
 select * into r from private.onboarding_receipts where subject=p_subject and idempotency_key=p_key;
 if found then if r.input<>i then raise exception 'CONFLICT';end if;return r.result;end if;
 select * into u from public.users where clerk_user_id=p_subject for update;
 if found and (u.role::text<>p_role or u.onboarding_completed_at is not null) then raise exception 'CONFLICT';end if;
 if p_role='cleaner' then
 perform 1 from public.cities where id=p_city and active for share;if not found then raise exception 'VALIDATION_ERROR';end if;
 if u.initial_city_selected_at is not null and u.approved_city_id is distinct from p_city then raise exception 'CONFLICT';end if;
 end if;
 if u.id is null then insert into public.users(clerk_user_id,role,display_name) values(p_subject,p_role::public.bloom_role,trim(p_name)) returning * into u;end if;
 update public.users set display_name=trim(p_name),approved_city_id=case when p_role='cleaner' then p_city else approved_city_id end,initial_city_selected_at=case when p_role='cleaner' then coalesce(initial_city_selected_at,clock_timestamp()) else initial_city_selected_at end,home_base=case when p_role='owner' then trim(p_home_base) else null end,onboarding_completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=u.id;
 if p_role='owner' and p_primary_email is not null then
 perform pg_advisory_xact_lock(hashtextextended('pending-owner:'||lower(trim(p_primary_email)),0));
 for x in select po.* from private.pending_property_owners po join public.properties p on p.id=po.property_id where po.email=lower(trim(p_primary_email)) and po.claimed_by is null and p.deleted_at is null order by po.property_id for update of po loop
 insert into public.property_owners values(x.property_id,u.id) on conflict do nothing;
 update private.pending_property_owners set claimed_by=u.id,claimed_at=clock_timestamp() where property_id=x.property_id;
 end loop;end if;
 result:=jsonb_build_object('status','complete','role',p_role,'destination','/'||p_role);
 insert into private.onboarding_receipts values(p_subject,p_key,i,result);return result;
end $$;
revoke all on function public.bloom_complete_onboarding(text,text,uuid,text,text,text,text) from public,anon,authenticated;grant execute on function public.bloom_complete_onboarding(text,text,uuid,text,text,text,text) to service_role;
-- The legacy direct cleaner RPC cannot bypass trusted role resolution or completion.
create or replace function public.bloom_onboard(p_city uuid,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$ begin raise exception 'INVALID_STATE';end $$;
create function public.bloom_provision_invited_admin(p_subject text,p_name text) returns void language plpgsql security definer set search_path='' as $$
declare u public.users;begin
 perform private.people_service();
 if coalesce(length(p_subject),0) not between 1 and 200 or coalesce(length(trim(p_name)),0) not between 1 and 100 then raise exception 'VALIDATION_ERROR';end if;
 perform pg_advisory_xact_lock(hashtextextended('onboard:'||p_subject,0));
 select * into u from public.users where clerk_user_id=p_subject for update;
 if found and u.role<>'admin' then raise exception 'CONFLICT';end if;
 if u.id is null then insert into public.users(clerk_user_id,role,display_name,onboarding_completed_at) values(p_subject,'admin',trim(p_name),clock_timestamp());end if;
end $$;
revoke all on function public.bloom_provision_invited_admin(text,text) from public,anon,authenticated;grant execute on function public.bloom_provision_invited_admin(text,text) to service_role;
commit;
