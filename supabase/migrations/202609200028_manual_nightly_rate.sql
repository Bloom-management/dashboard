begin;
create table public.property_nightly_rates (
 property_id uuid primary key references public.properties(id),
 cents integer not null check(cents between 0 and 100000000),
 updated_at timestamptz not null default now()
);
alter table public.property_nightly_rates enable row level security;
revoke all on public.property_nightly_rates from anon,authenticated;
grant select on public.property_nightly_rates to authenticated;
create function private.nightly_rate_access(p_property uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.people_access(p_property,(private.require_actor()).id);
$$;
revoke all on function private.nightly_rate_access(uuid) from public,anon;
grant execute on function private.nightly_rate_access(uuid) to authenticated;
create policy nightly_rate_read on public.property_nightly_rates for select to authenticated using (private.nightly_rate_access(property_id));
create function public.bloom_property_nightly_rate(p_property uuid,p_cents integer,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;r jsonb;input jsonb;begin
 u:=private.require_actor();
 perform 1 from public.properties where id=p_property for update;
 if not private.people_access(p_property,u.id) then raise exception 'NOT_FOUND';end if;
 if p_cents is null or p_cents<0 or p_cents>100000000 then raise exception 'VALIDATION_ERROR';end if;
 input:=jsonb_build_object('propertyId',p_property,'cents',p_cents);
 r:=private.receipt('property_nightly_rate',p_key::text,input);if r is not null then return r;end if;
 insert into public.property_nightly_rates(property_id,cents) values(p_property,p_cents) on conflict(property_id) do update set cents=excluded.cents,updated_at=clock_timestamp();
 return private.save_receipt('property_nightly_rate',p_key::text,input,jsonb_build_object('cents',p_cents));
end $$;
revoke all on function public.bloom_property_nightly_rate(uuid,integer,uuid) from public,anon;
grant execute on function public.bloom_property_nightly_rate(uuid,integer,uuid) to authenticated;
commit;
