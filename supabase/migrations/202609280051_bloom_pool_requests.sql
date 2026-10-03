-- Private invitations do not authorize public discovery. Existing authorized
-- cleaners (including opted-out cleaners with a previously selected city) stay approved.
alter table public.users add column bloom_pool_approved boolean not null default true;
update public.users set bloom_pool_approved=false where role='cleaner'
 and not bloom_network_enabled and initial_city_selected_at is null
 and not exists(select 1 from public.assignments a join public.jobs j on j.id=a.job_id where a.cleaner_id=users.id and j.cleaning_management='bloom');
create table private.bloom_pool_requests (
 id uuid primary key default gen_random_uuid(), cleaner_id uuid not null references public.users,
 requested_city_id uuid not null references public.cities,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(), resolved_at timestamptz,
 resolved_by uuid references public.users
);
create unique index bloom_pool_one_pending on private.bloom_pool_requests(cleaner_id) where status='pending';
revoke all on private.bloom_pool_requests from public,anon,authenticated,service_role;

-- Covers both invitation onboarding and later opt-in, including legacy RPCs.
create function private.guard_pool_access() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.role='cleaner' and not new.bloom_network_enabled then new.bloom_pool_approved:=false;end if;
 elsif new.role='cleaner' and new.bloom_network_enabled and not new.bloom_pool_approved then
  new.bloom_network_enabled:=false;
  if new.approved_city_id is not null then
   insert into private.bloom_pool_requests(cleaner_id,requested_city_id) values(new.id,new.approved_city_id)
    on conflict(cleaner_id) where status='pending' do nothing;
  end if;
 end if;
 return new;
end$$;
create trigger guard_pool_access before insert or update on public.users for each row execute function private.guard_pool_access();

alter function public.bloom_me() rename to bloom_me_before_pool;
revoke all on function public.bloom_me_before_pool() from public,anon,authenticated,service_role;
create function public.bloom_me() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u public.users;r jsonb;s text;begin
 u:=private.require_actor();r:=public.bloom_me_before_pool();
 select status into s from private.bloom_pool_requests where cleaner_id=u.id order by created_at desc,id desc limit 1;
 return r||jsonb_build_object('bloomPoolStatus',case when u.bloom_pool_approved then 'approved' else coalesce(s,'none') end);
end$$;

create function public.bloom_admin_requests(p_cursor uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;begin
 perform private.require_actor('admin');
 with requests as (
  select r.id,r.status,r.cleaner_id,r.requested_city_id,'city_change'::text kind from public.city_change_requests r
  union all select r.id,r.status,r.cleaner_id,r.requested_city_id,'bloom_pool' from private.bloom_pool_requests r
 ), page as (
  select r.id,jsonb_build_object('id',r.id,'status',r.status,'type',r.kind,'cleanerName',u.display_name,'requestedCityName',c.name) item
  from requests r join public.users u on u.id=r.cleaner_id join public.cities c on c.id=r.requested_city_id
  where p_cursor is null or r.id>p_cursor order by r.id limit 101
 ) select jsonb_build_object('items',coalesce((select jsonb_agg(item order by id) from (select * from page order by id limit 100) x),'[]'::jsonb),
 'nextCursor',case when (select count(*) from page)>100 then (select id from page order by id offset 99 limit 1) else null end) into r;
 return r;
end$$;

create function public.bloom_pool_resolve(p_request uuid,p_decision text,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.users;u public.users;q private.bloom_pool_requests;r jsonb;input jsonb:=jsonb_build_object('request',p_request,'decision',p_decision);begin
 a:=private.require_actor('admin');
 if p_decision not in ('approved','rejected') or p_decision is null then raise exception 'VALIDATION_ERROR';end if;
 select * into u from public.users where id=(select cleaner_id from private.bloom_pool_requests where id=p_request) for update;
 select * into q from private.bloom_pool_requests where id=p_request for update;
 if q.id is null then raise exception 'NOT_FOUND';end if;
 r:=private.receipt('pool_resolve',p_key,input);if r is not null then return r;end if;
 if q.status<>'pending' then raise exception 'CONFLICT';end if;
 if p_decision='approved' then
  if u.role<>'cleaner' or u.approved_city_id is distinct from q.requested_city_id or not exists(select 1 from public.cities where id=q.requested_city_id and active) then raise exception 'CITY_MISMATCH';end if;
  update public.users set bloom_pool_approved=true,bloom_network_enabled=true where id=u.id;
 end if;
 update private.bloom_pool_requests set status=p_decision,resolved_at=now(),resolved_by=a.id where id=q.id;
 return private.save_receipt('pool_resolve',p_key,input,jsonb_build_object('id',q.id,'status',p_decision));
end$$;
revoke all on function public.bloom_me(),public.bloom_admin_requests(uuid),public.bloom_pool_resolve(uuid,text,text) from public,anon,service_role;
grant execute on function public.bloom_me(),public.bloom_admin_requests(uuid),public.bloom_pool_resolve(uuid,text,text) to authenticated;
