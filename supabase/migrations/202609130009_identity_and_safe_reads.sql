begin;
create function public.bloom_owner_source_freshness(p_cursor uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u public.users;begin
 u:=private.require_actor('owner');
 return (select coalesce(jsonb_agg(jsonb_build_object('propertyId',page.id,'lastSuccessAt',h.success_at,'message',h.message) order by page.id),'[]')
 from (select p.id from public.properties p join public.property_owners po on po.property_id=p.id where po.owner_id=u.id and (p_cursor is null or p.id>p_cursor) order by p.id limit 100) page
 cross join lateral (select
 case when count(*)=0 or count(last_success_at)<count(*) then null else min(last_success_at) end success_at,
 case when count(*)=0 then 'Calendar source not configured.'
 when bool_or(last_error_code is not null or (active_run_id is not null and lease_expires_at<=now())) then 'Calendar update needs attention.'
 when bool_or(active_run_id is not null and lease_expires_at>now()) then 'Calendar update in progress.'
 when count(last_success_at)<count(*) then 'Calendar has not been checked.'
 else 'Calendar checked successfully.' end message
 from public.calendar_sources where property_id=page.id and enabled) h);
end $$;
create function public.bloom_assigned_job_detail(p_job uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u public.users;r jsonb;begin
 u:=private.require_actor();
 select jsonb_build_object('address',p.address,'instructions',coalesce(i.instructions,'')) into r
 from public.jobs j join public.properties p on p.id=j.property_id left join public.property_entry_instructions i on i.property_id=p.id
 where j.id=p_job and (u.role='admin' or (u.role='cleaner' and j.status='open' and private.assigned(j.id)));
 if r is null then raise exception 'NOT_FOUND';end if;return r;end $$;
-- No name from an HTTP payload or Clerk public/unsafe metadata enters this operation.
-- The restricted server helper fetches the verified session's Clerk User through its SDK.
create function public.bloom_provision_display_name(p_subject text,p_display_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;begin
 perform private.calendar_actor(null);
 if p_subject is null or length(p_subject) not between 1 and 200 or p_display_name is null or length(trim(p_display_name)) not between 1 and 100 or p_display_name ~ '[[:cntrl:]]' then perform private.calendar_error('VALIDATION_ERROR');end if;
 select * into u from public.users where clerk_user_id=p_subject for update;
 if not found then perform private.calendar_error('NOT_FOUND');end if;
 if u.display_name is distinct from trim(p_display_name) then
 update public.users set display_name=trim(p_display_name),updated_at=clock_timestamp() where id=u.id returning * into u;
 end if;
 return jsonb_build_object('id',u.id,'role',u.role,'displayName',u.display_name,'approvedCityId',u.approved_city_id);
end $$;
revoke all on function public.bloom_owner_source_freshness(uuid),public.bloom_assigned_job_detail(uuid),public.bloom_provision_display_name(text,text) from public,anon,authenticated;
grant execute on function public.bloom_owner_source_freshness(uuid),public.bloom_assigned_job_detail(uuid) to authenticated;
grant execute on function public.bloom_provision_display_name(text,text) to service_role;
commit;
