begin;

-- Completed summaries follow the existing entire-home audience: eligible cleaners
-- in the Bloom city, or the property's private team, plus authorized owners/admins.
-- This grant is read-only and does not authorize current access codes or edits.
create function private.completed_visit_read(p_job uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.jobs j where j.id=p_job and j.house_id is not null and j.status='completed'
 and ((private.job_visible_before_completed_visits(j.id) and (j.cleaning_management<>'private' or private.is_admin() or private.assigned(j.id)
 or not exists(select 1 from private.room_turnovers t where t.job_id=j.id and t.included and not private.team_member(t.property_id,(private.actor()).id))))
 or private.visit_access(j.id,true)))
$$;
create or replace function private.job_visible(p_job uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.jobs where id=p_job and house_id is not null and status='completed')
 then private.completed_visit_read(p_job) else private.job_visible_before_completed_visits(p_job) end
$$;
create or replace function private.photo_access(p_job uuid,p_write boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.jobs where id=p_job and house_id is not null) then
 exists(select 1 from public.jobs j where j.id=p_job and case when p_write then
 j.status='open' and not j.review_required and private.assigned(j.id)
 else private.visit_access(j.id) or private.completed_visit_read(j.id) end)
 else private.photo_access_before_room_visits(p_job,p_write) end
$$;

-- Snapshot the accepted rooms/spaces and reported item definitions with completion.
-- For older receipts reconstruct only the actual recorded reports, never live stock.
create function private.visit_summary_snapshot(p_job uuid,p_historical boolean default false) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'rooms',(select coalesce(jsonb_agg(jsonb_build_object('propertyId',p.id,'identifier',p.room_identifier) order by p.room_identifier),'[]')
 from private.room_turnovers t join public.properties p on p.id=t.property_id where t.job_id=j.id and t.included),
 'spaces',(select coalesce(jsonb_agg(jsonb_build_object('id',room->>'id','label',room->>'label','propertyId',sp.property_id,'scope',case when sp.property_id is null then 'shared' else 'room' end) order by ordinal),'[]')
 from jsonb_array_elements(j.cleaning_config->'rooms') with ordinality a(room,ordinal) join public.house_spaces sp on sp.id=(room->>'id')::uuid),
 'items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'kind',i.kind,'category',i.category,'name',i.name,'scope',case when i.property_id is null then 'shared' else 'room' end,'propertyId',i.property_id,'value',rep.value,'reportedAt',rep.reported_at,'authorId',rep.author_id) order by i.category,i.name),'[]')
 from public.house_items i left join lateral(select value,reported_at,author_id from public.house_item_reports where job_id=j.id and item_id=i.id order by revision desc limit 1) rep on true
 where i.house_id=j.house_id and (i.property_id is null or exists(select 1 from private.room_turnovers t where t.job_id=j.id and t.included and t.property_id=i.property_id))
 and case when p_historical then rep.reported_at is not null else i.active end))
 from public.jobs j where j.id=p_job
$$;

-- Keep the established completion transaction, validation, audit and payout path.
do $$declare def text;begin
 def:=pg_get_functiondef('private.complete_room_visit(uuid,jsonb,text)'::regprocedure);
 if position('insert into public.admin_notification_events' in def)=0 then raise exception 'Missing room completion boundary';end if;
 def:=replace(def,'insert into public.admin_notification_events',
 'r:=r||jsonb_build_object(''roomSummary'',private.visit_summary_snapshot(j.id)); insert into public.admin_notification_events');
 execute def;
end$$;

create or replace function public.bloom_cleaning_report(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare room_visit boolean;result jsonb;begin
 perform private.require_actor();select house_id is not null into room_visit from public.jobs where id=p_job;
 if room_visit and not private.completed_visit_read(p_job) then raise exception 'NOT_FOUND';end if;
 result:=private.cleaning_report_before_completed_visits(p_job);
 if room_visit then result:=result||jsonb_build_object('propertyName',private.job_dto(p_job)->>'propertyName',
 'roomSummary',coalesce(result->'receipt'->'roomSummary',private.visit_summary_snapshot(p_job,true)));end if;
 return result;
end$$;

-- Readiness is based on this visit's reports and all accepted physical spaces.
alter function public.bloom_room_visit(uuid) rename to bloom_room_visit_before_finish;
create function public.bloom_room_visit(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;j public.jobs;begin
 result:=public.bloom_room_visit_before_finish(p_job);select * into j from public.jobs where id=p_job;
 return result||jsonb_build_object('completion',jsonb_build_object(
 'photos',not exists(select 1 from jsonb_array_elements(j.cleaning_config->'rooms') room where not exists(select 1 from public.job_photos ph where ph.job_id=j.id and ph.room_id=(room->>'id')::uuid and ph.state='ready' and ph.note_context is null)),
 'supplies',not exists(select 1 from public.house_items i where i.house_id=j.house_id and i.active and i.kind='supply' and (i.property_id is null or exists(select 1 from private.room_turnovers t where t.job_id=j.id and t.included and t.property_id=i.property_id)) and not exists(select 1 from public.house_item_reports r where r.job_id=j.id and r.item_id=i.id)),
 'maintenance',not exists(select 1 from public.house_items i where i.house_id=j.house_id and i.active and i.kind='maintenance' and (i.property_id is null or exists(select 1 from private.room_turnovers t where t.job_id=j.id and t.included and t.property_id=i.property_id)) and not exists(select 1 from public.house_item_reports r where r.job_id=j.id and r.item_id=i.id))));
end$$;
revoke all on function private.completed_visit_read(uuid),private.visit_summary_snapshot(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.bloom_room_visit_before_finish(uuid) from public,anon,authenticated,service_role;
revoke all on function public.bloom_room_visit(uuid) from public,anon;
grant execute on function public.bloom_room_visit(uuid) to authenticated;
commit;
