begin;
-- The existing supply preview must read room/shared definitions, not an empty
-- legacy checklist. Eligibility grants read-only reference access, never entry codes.
do $$declare def text;begin
 def:=pg_get_functiondef('public.bloom_job_supplies(uuid)'::regprocedure);
 execute replace(def,'FUNCTION public.bloom_job_supplies(','FUNCTION private.job_supplies_before_room_inventory(');
end$$;
create or replace function public.bloom_job_supplies(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u public.users;j public.jobs;p public.properties;reference jsonb;begin
 u:=private.require_actor();select * into j from public.jobs where id=p_job;
 if j.house_id is null then return private.job_supplies_before_room_inventory(p_job);end if;
 select * into p from public.properties where id=j.property_id;
 if j.status='completed' then reference:=public.bloom_cleaning_report(p_job)->'roomSummary';
 else
 if j.status<>'open' or p.deleted_at is not null or not p.active or j.setup_required or not (
 private.visit_access(j.id) or (u.role='cleaner' and private.job_visible(j.id) and (j.cleaning_management<>'private'
 or not exists(select 1 from private.room_turnovers t where t.job_id=j.id and t.included and not private.team_member(t.property_id,u.id))))) then raise exception 'NOT_FOUND';end if;
 reference:=private.visit_summary_snapshot(j.id);
 -- Current stock reference uses the latest actual report; NULL remains unreported.
 reference:=reference||jsonb_build_object('items',(select coalesce(jsonb_agg(item||jsonb_build_object('value',r.value,'reportedAt',r.reported_at,'authorId',r.author_id) order by ordinal),'[]')
 from jsonb_array_elements(reference->'items') with ordinality a(item,ordinal)
 left join lateral(select value,reported_at,author_id from public.house_item_reports where item_id=(item->>'id')::uuid order by revision desc limit 1) r on true));
 end if;
 return jsonb_build_object('roomReference',reference,
 'supplies',(select coalesce(jsonb_agg(jsonb_build_object('id',item->>'id','name',item->>'name')),'[]') from jsonb_array_elements(reference->'items') item where item->>'kind'='supply'),
 'reports',(select coalesce(jsonb_agg(jsonb_build_object('supplyId',item->>'id','level',item->>'value','reportedAt',item->'reportedAt')),'[]') from jsonb_array_elements(reference->'items') item where item->>'kind'='supply' and item->>'value' is not null));
end$$;
revoke all on function private.job_supplies_before_room_inventory(uuid) from public,anon,authenticated,service_role;
commit;
