begin;
-- Owners/admins can mark a room-visit maintenance issue resolved; the report then drops its alert.
alter table public.house_item_reports add column resolved_at timestamptz, add column resolved_by uuid references public.users;

-- Read (p_item null): this visit's flagged items (latest report per item), with comment and resolution.
-- Resolve (p_item set): owners/admins mark the item's latest issue report resolved.
create function public.bloom_visit_issues(p_job uuid,p_item uuid default null,p_key text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.users;rep public.house_item_reports;r jsonb;input jsonb:=jsonb_build_object('job',p_job,'item',p_item);begin
 u:=private.require_actor();
 if not exists(select 1 from public.jobs where id=p_job and house_id is not null) then raise exception 'NOT_FOUND';end if;
 if p_item is null then
  if not (private.visit_access(p_job) or private.completed_visit_read(p_job)) then raise exception 'NOT_FOUND';end if;
  return jsonb_build_object('canResolve',private.visit_access(p_job,true),'issues',coalesce((select jsonb_agg(jsonb_build_object('itemId',x.item_id,'notes',x.notes,'reportedAt',x.reported_at,'resolvedAt',x.resolved_at,'resolvedByName',(select display_name from public.users where id=x.resolved_by)) order by x.reported_at)
   from (select distinct on(item_id) item_id,value,notes,reported_at,resolved_at,resolved_by from public.house_item_reports where job_id=p_job order by item_id,revision desc) x where x.value='issue'),'[]'::jsonb));
 end if;
 perform 1 from public.jobs where id=p_job for update;
 if not private.visit_access(p_job,true) then raise exception 'NOT_FOUND';end if;
 r:=private.receipt('visit_issue_resolve',p_key,input);if r is not null then return r;end if;
 select * into rep from public.house_item_reports where job_id=p_job and item_id=p_item order by revision desc limit 1 for update;
 if rep.id is null or rep.value<>'issue' then raise exception 'INVALID_STATE';end if;
 update public.house_item_reports set resolved_at=coalesce(resolved_at,now()),resolved_by=coalesce(resolved_by,u.id) where id=rep.id returning * into rep;
 return private.save_receipt('visit_issue_resolve',p_key,input,jsonb_build_object('itemId',p_item,'resolvedAt',rep.resolved_at,'resolvedByName',(select display_name from public.users where id=rep.resolved_by)));
end $$;
revoke all on function public.bloom_visit_issues(uuid,uuid,text) from public,anon;
grant execute on function public.bloom_visit_issues(uuid,uuid,text) to authenticated;
commit;
