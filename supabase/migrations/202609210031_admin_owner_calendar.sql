begin;
-- Owner Hub needs every imported event; the flagged review list remains separate.
create function public.bloom_admin_property_calendar_events(p_property uuid,p_cursor uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 perform private.require_actor('admin');
 if not exists(select 1 from public.properties where id=p_property and deleted_at is null) then raise exception 'NOT_FOUND';end if;
 with page as (
 select e.id,e.source_id,s.provider,e.start_local_date,e.end_local_date,e.kind,e.source_status,e.review_required,e.missing_reason
 from public.calendar_events e join public.calendar_sources s on s.id=e.source_id
 where s.property_id=p_property and (p_cursor is null or e.id>p_cursor)
 order by e.id limit 101
 ),shown as(select * from page order by id limit 100)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
 'id',e.id,'sourceId',e.source_id,'provider',e.provider,'startDate',e.start_local_date,
 'endDate',e.end_local_date,'kind',e.kind,'status',e.source_status,
 'reviewRequired',e.review_required,'missingReason',e.missing_reason) order by e.id) from shown e),'[]'::jsonb),
 'nextCursor',case when (select count(*) from page)>100 then (select max(id::text) from shown) else null end) into result;
 return result;
end $$;
revoke all on function public.bloom_admin_property_calendar_events(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.bloom_admin_property_calendar_events(uuid,uuid) to authenticated;
commit;
