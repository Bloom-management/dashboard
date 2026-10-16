begin;
alter table private.push_preferences add column starts boolean not null default true;
alter table private.push_messages drop constraint push_messages_kind_check;
alter table private.push_messages add constraint push_messages_kind_check check(kind in ('new','evening','morning','test','completion','handoff','start'));

alter function public.bloom_push_device(text,uuid,text,text,jsonb) rename to bloom_push_device_before_starts;
revoke all on function public.bloom_push_device_before_starts(text,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
create function public.bloom_push_device(p_device text,p_user uuid,p_session text,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 result:=public.bloom_push_device_before_starts(p_device,p_user,p_session,p_action,p_input);
 if p_action='preferences' and p_input ? 'starts' then
  if jsonb_typeof(p_input->'starts')<>'boolean' then raise sqlstate 'PT400' using message='VALIDATION_ERROR';end if;
  update private.push_preferences set starts=(p_input->>'starts')::boolean where user_id=p_user;
 end if;
 return result||jsonb_build_object('starts',(select starts from private.push_preferences where user_id=p_user));
end $$;
revoke all on function public.bloom_push_device(text,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.bloom_push_device(text,uuid,text,text,jsonb) to service_role;

create table private.cleaning_start_events(job_id uuid primary key references public.jobs(id),started_at timestamptz not null);
alter table private.cleaning_start_events enable row level security;
revoke all on private.cleaning_start_events from public,anon,authenticated,service_role;
create function private.record_cleaning_start() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.started_at is null and new.started_at is not null and new.status='open' then
  insert into private.cleaning_start_events values(new.id,new.started_at) on conflict do nothing;
  if (select activated_at is not null from private.push_control where singleton) then
   insert into private.push_messages(logical_key,user_id,kind,job_ids,expires_at)
   select 'start:'||new.id||':'||u.id,u.id,'start',array[new.id],now()+interval '24 hours'
   from public.users u join private.push_preferences s on s.user_id=u.id and s.starts
   where u.role='admin' or (u.role='owner' and exists(select 1 from public.property_owners where property_id=new.property_id and owner_id=u.id))
   on conflict(logical_key) do nothing;
  end if;
 end if;
 return new;
end $$;
revoke all on function private.record_cleaning_start() from public,anon,authenticated,service_role;
create trigger cleaning_started_notifications after update of started_at on public.jobs for each row execute function private.record_cleaning_start();

alter function private.push_content(uuid,timestamptz) rename to push_content_before_starts;
create function private.push_content(p_message uuid,p_now timestamptz) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m private.push_messages;u public.users;j public.jobs;label text;begin
 select * into m from private.push_messages where id=p_message;
 if m.kind is distinct from 'start' then return private.push_content_before_starts(p_message,p_now);end if;
 select * into u from public.users where id=m.user_id;
 select * into j from public.jobs where id=m.job_ids[1];
 if m.expires_at<=p_now or j.id is null or j.status<>'open' or j.started_at is null then return null;end if;
 if not exists(select 1 from private.push_preferences where user_id=u.id and starts) then return null;end if;
 if not (u.role='admin' or (u.role='owner' and exists(select 1 from public.property_owners where property_id=j.property_id and owner_id=u.id))) then return null;end if;
 select name into label from public.properties where id=j.property_id;
 return jsonb_build_object('body','Cleaning started at '||label||'.','url','/'||u.role||case when u.role='owner' then '?view=calendar&date=' else '?view=jobs&date=' end||j.checkout_date,'count',1);
end $$;
revoke all on function private.push_content(uuid,timestamptz),private.push_content_before_starts(uuid,timestamptz) from public,anon,authenticated,service_role;

alter function private.inbox_items() rename to inbox_items_before_starts;
create function private.inbox_items() returns table(id text,body text,href text,dismissible boolean) language plpgsql stable security definer set search_path='' as $$
declare actor public.users;begin
 actor:=private.require_actor();
 return query select * from private.inbox_items_before_starts();
 if actor.role in ('admin','owner') then
  return query select 'start:'||j.id,p.name||': cleaning started for '||to_char(j.checkout_date,'Mon DD, YYYY')||'.','/'||actor.role||case when actor.role='owner' then '?view=calendar&date=' else '?view=jobs&date=' end||j.checkout_date,true
  from private.cleaning_start_events e join public.jobs j on j.id=e.job_id join public.properties p on p.id=j.property_id
  where j.status<>'cancelled' and private.people_access(p.id,actor.id);
 end if;
end $$;
revoke all on function private.inbox_items(),private.inbox_items_before_starts() from public,anon,authenticated,service_role;
commit;
