begin;
alter table public.properties add column cleaner_pricing_set boolean not null default true;
update public.properties set cleaner_pricing_set=false where owner_created and deleted_at is null;
alter table public.jobs add column payout_overridden boolean not null default false;
create function private.initial_cleaner_pricing() returns trigger language plpgsql set search_path='' as $$ begin new.cleaner_pricing_set:=not new.owner_created;return new;end $$;
create trigger initial_cleaner_pricing before insert on public.properties for each row execute function private.initial_cleaner_pricing();
create table private.cleaner_pricing_audit(id uuid primary key default gen_random_uuid(),actor_id uuid not null,property_id uuid,job_id uuid,old_cents integer not null,new_cents integer not null,reason text,created_at timestamptz not null default now());
create function public.bloom_admin_pricing(p_property uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 perform private.require_actor('admin');
 if p_property is null then return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from public.properties where deleted_at is null and active and not cleaner_pricing_set),'[]'::jsonb);end if;
 return (select jsonb_build_object('cents',solo_rate_cents,'configured',cleaner_pricing_set) from public.properties where id=p_property and deleted_at is null);
end $$;
create function public.bloom_admin_set_pricing(p_id uuid,p_cents integer,p_key text,p_job boolean default false,p_version integer default null,p_reason text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;p public.properties;j public.jobs;r jsonb;input jsonb;begin
 u:=private.require_actor('admin');
 if p_cents is null or p_cents<2 or p_cents>100000000 or p_cents%2<>0 then raise exception 'VALIDATION_ERROR';end if;
 input:=jsonb_build_object('id',p_id,'cents',p_cents,'job',p_job,'version',p_version,'reason',p_reason);
 -- Serialize receipts and updates per target.
 if p_job then select * into j from public.jobs where id=p_id for update;else select * into p from public.properties where id=p_id and deleted_at is null for update;end if;
 if not found then raise exception 'NOT_FOUND';end if;
 r:=private.receipt('admin_cleaner_pricing',p_key,input);if r is not null then return r;end if;
 if p_job then
  if p_version is null or j.version<>p_version then raise exception 'CONFLICT';end if;
  if j.status<>'open' then raise exception 'INVALID_STATE';end if;
  if p_reason is null or length(trim(p_reason))=0 or length(p_reason)>1000 then raise exception 'VALIDATION_ERROR';end if;
  insert into private.cleaner_pricing_audit(actor_id,job_id,old_cents,new_cents,reason) values(u.id,j.id,j.solo_rate_cents_snapshot,p_cents,trim(p_reason));
  update public.jobs set solo_rate_cents_snapshot=p_cents,payout_overridden=true,version=version+1,updated_at=clock_timestamp() where id=j.id;

 else
  insert into private.cleaner_pricing_audit(actor_id,property_id,old_cents,new_cents) values(u.id,p.id,p.solo_rate_cents,p_cents);
  update public.properties set solo_rate_cents=p_cents,cleaner_pricing_set=true where id=p.id;
  perform 1 from public.jobs where property_id=p.id order by id for update;
  update public.jobs j2 set solo_rate_cents_snapshot=p_cents,version=version+1,updated_at=clock_timestamp() where property_id=p.id and status='open' and not payout_overridden and not exists(select 1 from public.assignments a where a.job_id=j2.id and a.ended_at is null);
 end if;
 return private.save_receipt('admin_cleaner_pricing',p_key,input,jsonb_build_object('cents',p_cents));
end $$;
revoke all on function public.bloom_admin_pricing(uuid),public.bloom_admin_set_pricing(uuid,integer,text,boolean,integer,text) from public,anon;
grant execute on function public.bloom_admin_pricing(uuid),public.bloom_admin_set_pricing(uuid,integer,text,boolean,integer,text) to authenticated;
commit;
