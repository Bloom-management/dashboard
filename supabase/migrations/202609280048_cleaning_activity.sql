begin;
-- Preserve the completion event once, without notifying for historical jobs.
create table private.cleaning_activity_events (
 job_id uuid primary key references public.jobs(id),
 completed_at timestamptz not null
);
alter table private.cleaning_activity_events enable row level security;
revoke all on private.cleaning_activity_events from public,anon,authenticated,service_role;
create function private.record_cleaning_activity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='completed' and old.status is distinct from 'completed' then
  insert into private.cleaning_activity_events values(new.id,coalesce(new.completed_at,clock_timestamp())) on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function private.record_cleaning_activity() from public,anon,authenticated,service_role;
create trigger cleaning_activity_completed after update of status on public.jobs for each row execute function private.record_cleaning_activity();

create function public.bloom_cleaning_activity(p_offset integer default 0,p_job uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.users; result jsonb; total integer;
begin
 actor:=private.require_actor();
 if actor.role not in ('admin','owner') then raise exception 'FORBIDDEN';end if;
 if p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'VALIDATION_ERROR';end if;
 if p_job is not null and not exists(select 1 from public.jobs j where j.id=p_job and j.status='completed' and private.people_access(j.property_id,actor.id)) then raise exception 'NOT_FOUND';end if;
 select count(*) into total from public.jobs j where j.status='completed' and private.people_access(j.property_id,actor.id) and (p_job is null or j.id=p_job);
 select coalesce(jsonb_agg(x.item order by x.completed_at desc nulls last,x.id desc),'[]') into result from (
 select j.id,j.completed_at,jsonb_build_object(
  'id',j.id,'propertyId',p.id,'propertyName',p.name,'date',j.checkout_date,'timezone',j.timezone_snapshot,'completedAt',j.completed_at,
  'photoCount',(select count(*) from public.job_photos ph where ph.job_id=j.id and ph.state='ready'),
  'photos',case when p_job is null then null else coalesce((select jsonb_agg(private.photo_dto(ph.id)||jsonb_build_object('locationLabel',
    coalesce((select room->>'label' from jsonb_array_elements(j.cleaning_config->'rooms') room where room->>'id'=ph.room_id::text limit 1),
    case ph.category when 'bedrooms' then 'Bedrooms' when 'bathrooms' then 'Bathrooms' when 'kitchen' then 'Kitchen' when 'living_room' then 'Living room' else 'Unassigned location' end))
    order by ph.created_at,ph.id) from public.job_photos ph where ph.job_id=j.id and ph.state='ready'),'[]') end
 ) item from public.jobs j join public.properties p on p.id=j.property_id
 where j.status='completed' and private.people_access(p.id,actor.id) and (p_job is null or j.id=p_job)
 order by j.completed_at desc nulls last,j.id desc limit 10 offset p_offset
 ) x;
 return jsonb_build_object('items',result,'total',total);
end $$;
revoke all on function public.bloom_cleaning_activity(integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.bloom_cleaning_activity(integer,uuid) to authenticated;

alter function private.inbox_items() rename to inbox_items_before_activity;
create function private.inbox_items() returns table(id text,body text,href text,dismissible boolean)
language plpgsql stable security definer set search_path='' as $$
declare actor public.users;begin
 actor:=private.require_actor();
 return query select i.id,i.body,i.href,i.dismissible from private.inbox_items_before_activity() i;
 if actor.role in ('admin','owner') then
  return query select 'completion:'||j.id::text,
   p.name||': cleaning completed for '||to_char(j.checkout_date,'Mon DD, YYYY')||'. View completion photos.',
   case when actor.role='admin' then '/admin' else '/owner' end||'?view=activity&job='||j.id::text,true
  from private.cleaning_activity_events e join public.jobs j on j.id=e.job_id join public.properties p on p.id=j.property_id
  where j.status='completed' and private.people_access(p.id,actor.id);
 end if;
end $$;
revoke all on function private.inbox_items(),private.inbox_items_before_activity() from public,anon,authenticated,service_role;
commit;
