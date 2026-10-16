begin;
-- Only permanent Mapbox city results; no user identifiers or search ownership.
create table public.city_search_cache (
 query_key text primary key,
 places jsonb not null check (jsonb_typeof(places)='array'),
 created_at timestamptz not null default now()
);
alter table public.city_search_cache enable row level security;
revoke all on public.city_search_cache from public,anon,authenticated;
grant select,insert,update on public.city_search_cache to service_role;
commit;
