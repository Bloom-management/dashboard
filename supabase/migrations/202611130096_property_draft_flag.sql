begin;
-- Admin listing/performance reads must exclude drafts, but signed-in users only hold
-- column grants on properties and draft_data (the draft's content) is not one of them.
-- Expose a derived flag instead of the draft itself; filtering on draft_data was denied (42501).
alter table public.properties add column is_draft boolean generated always as (draft_data is not null) stored;
grant select(is_draft) on public.properties to authenticated;
commit;
