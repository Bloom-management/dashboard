begin;
-- Entire homes (no house) can keep their own maintenance checks, the same items room listings use.
-- Such items have no house and belong to exactly one property.
alter table public.house_items alter column house_id drop not null;
alter table public.house_items add constraint house_items_entire_home_maintenance
 check (house_id is not null or (property_id is not null and kind='maintenance'));

create or replace function public.bloom_house_items(p_property uuid, p_item uuid default null, p_action text default 'list', p_value text default null, p_revision integer default null, p_job uuid default null, p_key text default null)
 returns jsonb language plpgsql security definer set search_path to '' as $function$
declare u public.users;p public.properties;i public.house_items;r jsonb;v_input jsonb:=jsonb_build_object('property',p_property,'item',p_item,'action',p_action,'value',p_value,'revision',p_revision,'job',p_job);manager boolean;home boolean;begin
 u:=private.require_actor();select * into p from public.properties where id=p_property and deleted_at is null;
 manager:=u.role='admin' or exists(select 1 from public.property_owners where property_id=p.id and owner_id=u.id);
 home:=p.house_id is null and p.listing_type='entire_home';
 if p.id is null or (p.house_id is null and not home) or not (manager or (p.draft_data is null and exists(select 1 from public.jobs j where j.id=p_job and (j.property_id=p.id or exists(select 1 from private.room_turnovers rt where rt.job_id=j.id and rt.property_id=p.id and rt.included)) and j.status in ('open','completed') and private.assigned(j.id)))) then raise exception 'NOT_FOUND';end if;
 if p_job is not null and not home and not exists(select 1 from public.jobs scoped join private.room_turnovers rt on rt.job_id=scoped.id where scoped.id=p_job and scoped.house_id=p.house_id and rt.property_id=p.id and rt.included) then raise exception 'NOT_FOUND';end if;
 if p_job is not null and home and not exists(select 1 from public.jobs where id=p_job and property_id=p.id) then raise exception 'NOT_FOUND';end if;
 if p_job is not null and p_action='report' and exists(select 1 from public.jobs where id=p_job and status<>'open') then raise exception 'INVALID_STATE';end if;
 if p_action='list' then
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.category,x.name) from (select t.id,t.kind,t.category,t.name,t.proposed,t.revision,case when t.property_id is null then 'shared' else 'room' end scope,(select value from public.house_item_reports where item_id=t.id order by revision desc limit 1) value,(select reported_at from public.house_item_reports where item_id=t.id order by revision desc limit 1) "reportedAt" from public.house_items t where t.active and (case when home then t.house_id is null and t.property_id=p.id else t.house_id=p.house_id and (t.property_id is null or t.property_id=p.id) end))x),'[]');end if;
 if not manager and not exists(select 1 from public.jobs where id=p_job and status='open' and started_at is not null and not review_required) then raise exception 'INVALID_STATE';end if;
 if p_action in ('add_room_supply','add_shared_supply','add_room_maintenance','add_shared_maintenance') then
 if not manager then raise exception 'FORBIDDEN';end if;
 -- Entire homes keep supplies in their cleaning setup; only their own maintenance checks live here.
 if home and p_action<>'add_room_maintenance' then raise exception 'VALIDATION_ERROR';end if;
 if p_value is null or length(trim(p_value)) not between 1 and 200 then raise exception 'VALIDATION_ERROR';end if;
 r:=private.receipt('house_item',p_key,v_input);if r is not null then return r;end if;
 insert into public.house_items(house_id,property_id,kind,category,name,proposed)
 values(p.house_id,case when split_part(p_action,'_',2)='room' then p.id end,split_part(p_action,'_',3),case when split_part(p_action,'_',2)='room' then 'Room' else 'Shared' end,trim(p_value),false)
 on conflict(house_id,property_id,kind,category,name) do update set active=true,proposed=false,revision=public.house_items.revision+1 where not public.house_items.active returning * into i;
 if i.id is null then raise exception 'CONFLICT';end if;
 return private.save_receipt('house_item',p_key,v_input,jsonb_build_object('id',i.id,'revision',i.revision));
 end if;
 select * into i from public.house_items
  where id=p_item and (case when home then house_id is null and property_id=p.id else house_id=p.house_id and (property_id is null or property_id=p.id) end) for update;
 if i.id is null then raise exception 'NOT_FOUND';end if;
 r:=private.receipt('house_item',p_key,v_input);if r is not null then return r;end if;
 if i.revision is distinct from p_revision then raise exception 'CONFLICT';end if;
 if p_action='remove' and manager then update public.house_items set active=false,revision=revision+1 where id=i.id;
 elsif p_action='rename' and manager and length(trim(p_value)) between 1 and 200 then update public.house_items set name=trim(p_value),revision=revision+1 where id=i.id;
 elsif p_action='report' then if p_job is not null and exists(select 1 from public.house_item_reports rep where rep.item_id=i.id and rep.job_id=p_job and rep.revision=i.revision and rep.value=p_value) then return private.save_receipt('house_item',p_key,v_input,jsonb_build_object('id',i.id,'revision',i.revision));end if;
 if (i.kind='supply' and p_value not in ('full','moderate','low','empty','not_found')) or (i.kind='maintenance' and p_value not in ('good','issue','not_applicable')) or p_value is null then raise exception 'VALIDATION_ERROR';end if;
 update public.house_items set revision=revision+1 where id=i.id;
 insert into public.house_item_reports(item_id,revision,value,author_id,job_id) values(i.id,i.revision+1,p_value,u.id,p_job);
 else raise exception 'VALIDATION_ERROR';end if;
 return private.save_receipt('house_item',p_key,v_input,jsonb_build_object('id',i.id,'revision',i.revision+1));
end $function$;
-- "Needs attention" notices: entire-home visits have no house, so name the property and notify its owners.
create or replace function private.visit_notice(p_job uuid, p_event text, p_body text, p_cleaner uuid default null)
 returns void language sql security definer set search_path to '' as $function$
 insert into private.visit_notices(job_id,user_id,event_key,body)
 select p_job,u.id,p_event,case when p_cleaner is null then (select coalesce(h.name,pr.name)||' · '||to_char(j.checkout_date,'Mon FMDD, YYYY') from public.jobs j left join public.houses h on h.id=j.house_id left join public.properties pr on pr.id=j.property_id where j.id=p_job)||' · '||p_body else p_body end from public.users u where
 case when p_cleaner is not null then u.id=p_cleaner else u.role='admin'
  or exists(select 1 from public.property_owners o join public.properties p on p.id=o.property_id join public.jobs j on j.house_id=p.house_id where j.id=p_job and o.owner_id=u.id)
  or exists(select 1 from public.property_owners o join public.jobs j on j.property_id=o.property_id where j.id=p_job and j.house_id is null and o.owner_id=u.id) end
 on conflict do nothing
$function$;
commit;
