begin;
alter table private.push_preferences add column low_supplies boolean not null default true,add column maintenance boolean not null default true;
alter table private.push_messages drop constraint push_messages_kind_check;
alter table private.push_messages add constraint push_messages_kind_check check(kind in ('new','evening','morning','test','completion','handoff','start','low_supplies','maintenance'));
create table private.property_report_alerts (
 job_id uuid not null references public.jobs,kind text not null check(kind in ('low_supplies','maintenance')),
 details text not null,created_at timestamptz not null default now(),primary key(job_id,kind)
);
alter table private.property_report_alerts enable row level security;
revoke all on private.property_report_alerts from public,anon,authenticated,service_role;

alter function public.bloom_push_device(text,uuid,text,text,jsonb) rename to bloom_push_device_before_reports;
revoke all on function public.bloom_push_device_before_reports(text,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
create function public.bloom_push_device(p_device text,p_user uuid,p_session text,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 result:=public.bloom_push_device_before_reports(p_device,p_user,p_session,p_action,p_input);
 if p_action='preferences' then
  if (p_input ? 'lowSupplies' and jsonb_typeof(p_input->'lowSupplies')<>'boolean') or (p_input ? 'maintenance' and jsonb_typeof(p_input->'maintenance')<>'boolean') then raise exception 'VALIDATION_ERROR';end if;
  update private.push_preferences set low_supplies=coalesce((p_input->>'lowSupplies')::boolean,low_supplies),maintenance=coalesce((p_input->>'maintenance')::boolean,maintenance) where user_id=p_user;
 end if;
 return result||coalesce((select jsonb_build_object('lowSupplies',low_supplies,'maintenance',maintenance) from private.push_preferences where user_id=p_user),'{}');
end $$;
revoke all on function public.bloom_push_device(text,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.bloom_push_device(text,uuid,text,text,jsonb) to service_role;

create function private.record_property_report_alerts() returns trigger language plpgsql security definer set search_path='' as $$
declare alert record;begin
 if new.status='completed' and old.status is distinct from 'completed' then
  insert into private.property_report_alerts(job_id,kind,details)
  select new.id,'low_supplies',string_agg(r.name,', ' order by r.name)
  from public.job_supply_reports r where r.job_id=new.id and r.level in ('low','empty')
  having count(*)>0 on conflict do nothing;
  insert into private.property_report_alerts(job_id,kind,details)
  select new.id,'maintenance',string_agg(case r.category when 'fridge' then 'Refrigerator' when 'wifi' then 'Wi-Fi' when 'tv' then 'TV' else initcap(r.category) end,', ' order by r.category)
  from public.job_maintenance_reports r join public.users reporter on reporter.id=r.reported_by
  where r.job_id=new.id and r.status='attention' and reporter.role='cleaner'
  having count(*)>0 on conflict do nothing;
  if (select activated_at is not null from private.push_control where singleton) then
   for alert in select * from private.property_report_alerts where job_id=new.id loop
    insert into private.push_messages(logical_key,user_id,kind,job_ids,expires_at)
    select alert.kind||':'||new.id||':'||u.id,u.id,alert.kind,array[new.id],now()+interval '24 hours'
    from public.property_owners po join public.users u on u.id=po.owner_id and u.role='owner'
    join private.push_preferences s on s.user_id=u.id
    where po.property_id=new.property_id and case when alert.kind='low_supplies' then s.low_supplies else s.maintenance end
    on conflict(logical_key) do nothing;
   end loop;
  end if;
 end if;
 return new;
end $$;
revoke all on function private.record_property_report_alerts() from public,anon,authenticated,service_role;
create trigger property_report_alerts_completed after update of status on public.jobs for each row execute function private.record_property_report_alerts();

alter function private.push_content(uuid,timestamptz) rename to push_content_before_reports;
create function private.push_content(p_message uuid,p_now timestamptz) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m private.push_messages;j public.jobs;label text;details text;begin
 select * into m from private.push_messages where id=p_message;
 if m.kind not in ('low_supplies','maintenance') or m.kind is null then return private.push_content_before_reports(p_message,p_now);end if;
 select * into j from public.jobs where id=m.job_ids[1];
 if m.expires_at<=p_now or j.id is null or j.status<>'completed' then return null;end if;
 if not exists(select 1 from public.property_owners po join public.users u on u.id=po.owner_id and u.role='owner' where po.property_id=j.property_id and po.owner_id=m.user_id) then return null;end if;
 if not exists(select 1 from private.push_preferences s where s.user_id=m.user_id and case when m.kind='low_supplies' then s.low_supplies else s.maintenance end) then return null;end if;
 select p.name into label from public.properties p where p.id=j.property_id and p.deleted_at is null;if label is null then return null;end if;
 select a.details into details from private.property_report_alerts a where a.job_id=j.id and a.kind=m.kind;if details is null then return null;end if;
 return jsonb_build_object('body',label||case when m.kind='low_supplies' then ': supplies low — ' else ': maintenance reported — ' end||details||'.','url','/owner?view=listings&property='||j.property_id||'&section='||case when m.kind='low_supplies' then 'supplies' else 'maintenance' end,'count',1);
end $$;
revoke all on function private.push_content(uuid,timestamptz),private.push_content_before_reports(uuid,timestamptz) from public,anon,authenticated,service_role;

alter function private.inbox_items() rename to inbox_items_before_reports;
create function private.inbox_items() returns table(id text,body text,href text,dismissible boolean) language plpgsql stable security definer set search_path='' as $$
declare actor public.users;begin
 actor:=private.require_actor();return query select * from private.inbox_items_before_reports();
 if actor.role='owner' then
  return query select a.kind||':'||j.id,p.name||case when a.kind='low_supplies' then ': supplies low — ' else ': maintenance reported — ' end||a.details||' ('||to_char(j.checkout_date,'Mon DD, YYYY')||').',
   '/owner?view=listings&property='||p.id||'&section='||case when a.kind='low_supplies' then 'supplies' else 'maintenance' end,true
  from private.property_report_alerts a join public.jobs j on j.id=a.job_id join public.properties p on p.id=j.property_id
  where j.status='completed' and p.deleted_at is null and exists(select 1 from public.property_owners po where po.property_id=p.id and po.owner_id=actor.id);
 end if;
end $$;
revoke all on function private.inbox_items(),private.inbox_items_before_reports() from public,anon,authenticated,service_role;
commit;
