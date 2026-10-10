begin;
create table private.cleaning_handoffs (
 job_id uuid primary key references public.jobs,
 revision integer not null default 0,
 draft jsonb not null,
 sender_id uuid not null references public.users,
 updated_at timestamptz not null default now()
);
revoke all on private.cleaning_handoffs from public,anon,authenticated,service_role;

create function private.handoff_missing(p_job uuid,p_draft jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare j public.jobs;item jsonb;missing jsonb:='[]';begin
 select * into j from public.jobs where id=p_job;
 for item in select value from jsonb_array_elements(j.cleaning_config->'rooms') loop
  if not exists(select 1 from public.job_photos where job_id=p_job and state='ready' and room_id=(item->>'id')::uuid) then missing:=missing||jsonb_build_array('Photo: '||(item->>'label'));end if;
 end loop;
 if not coalesce(p_draft->'reviewed','[]') ? 'supplies' then missing:=missing||'"Supplies check"'::jsonb;end if;
 if not coalesce(p_draft->'reviewed','[]') ? 'maintenance' then missing:=missing||'"Maintenance check"'::jsonb;end if;
 for item in select value from jsonb_each(coalesce(p_draft->'maintenance','{}')) loop
  if item->>'status'='attention' and trim(item->>'notes')='' then missing:=missing||jsonb_build_array('Maintenance note: '||(item->>'category'));end if;
 end loop;
 if coalesce((p_draft->'guestReview'->>'rating')::numeric,0)<1 then missing:=missing||'"Guest rating"'::jsonb;end if;
 return missing;
end $$;

create function public.bloom_cleaning_handoff(p_job uuid,p_draft jsonb default null,p_revision integer default 0,p_key text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.users;j public.jobs;h private.cleaning_handoffs;v jsonb;k text;r jsonb;recipient uuid;missing jsonb;message text;input jsonb;begin
 actor:=private.require_actor();
 select * into j from public.jobs where id=p_job for update;
 if j.id is null or not private.assigned(p_job) then raise exception 'NOT_FOUND';end if;
 select * into h from private.cleaning_handoffs where job_id=p_job;
 if p_draft is not null then
  input:=jsonb_build_object('job',p_job,'draft',p_draft,'revision',p_revision);
  r:=private.receipt('cleaning_handoff',p_key,input);if r is not null then return r;end if;
  if j.status<>'open' or j.started_at is null then raise exception 'INVALID_STATE';end if;
  if j.review_required then raise exception 'REVIEW_REQUIRED';end if;
  if p_revision is distinct from coalesce(h.revision,0) then raise exception 'CONFLICT';end if;
  if h.sender_id=actor.id and h.updated_at>now()-interval '1 minute' then raise exception 'CONFLICT';end if;
  if not exists(select 1 from public.assignments where job_id=p_job and cleaner_id<>actor.id and ended_at is null) then raise exception 'INVALID_STATE';end if;
  if jsonb_typeof(p_draft) is distinct from 'object' or octet_length(p_draft::text)>16000
   or exists(select 1 from jsonb_object_keys(p_draft) x where x not in ('answers','notes','maintenance','guestReview','reviewed','version'))
   or jsonb_typeof(p_draft->'answers') is distinct from 'object' or jsonb_typeof(p_draft->'maintenance') is distinct from 'object'
   or jsonb_typeof(p_draft->'notes') is distinct from 'string' or length(p_draft->>'notes')>1500
   or p_draft->'version' is distinct from j.cleaning_config->'version'
   or jsonb_typeof(p_draft->'reviewed') is distinct from 'array' then raise exception 'VALIDATION_ERROR';end if;
  if exists(select 1 from jsonb_array_elements(p_draft->'reviewed') x where x not in ('"supplies"'::jsonb,'"maintenance"'::jsonb)) then raise exception 'VALIDATION_ERROR';end if;
  for k,v in select * from jsonb_each(p_draft->'answers') loop
   if not exists(select 1 from jsonb_array_elements(j.cleaning_config->'supplies') x where x->>'id'=k)
    or v not in ('"full"'::jsonb,'"moderate"'::jsonb,'"low"'::jsonb,'"empty"'::jsonb,'"not_found"'::jsonb) then raise exception 'VALIDATION_ERROR';end if;
  end loop;
  for k,v in select * from jsonb_each(p_draft->'maintenance') loop
   if k not in ('painting','fridge','electricity','wifi','tv','garage','climate','water') or v->>'category' is distinct from k
    or coalesce(v->>'status','') not in ('ok','attention','not_applicable') or jsonb_typeof(v->'notes') is distinct from 'string' or length(v->>'notes')>500 then raise exception 'VALIDATION_ERROR';end if;
  end loop;
  if p_draft ? 'guestReview' then
   v:=p_draft->'guestReview';
   if jsonb_typeof(v->'rating') is distinct from 'number' or (v->>'rating') !~ '^(0|[1-4](\.5)?|5)$' or jsonb_typeof(v->'comment') is distinct from 'string' or length(v->>'comment')>1500 then raise exception 'VALIDATION_ERROR';end if;
  end if;
  insert into private.cleaning_handoffs(job_id,revision,draft,sender_id) values(p_job,1,p_draft,actor.id)
   on conflict(job_id) do update set revision=cleaning_handoffs.revision+1,draft=excluded.draft,sender_id=excluded.sender_id,updated_at=now() returning * into h;
  missing:=private.handoff_missing(p_job,p_draft);
  message:=actor.display_name||' asked you to finish '||(select name from public.properties where id=j.property_id)||'. '||case when jsonb_array_length(missing)>0 then 'Still needed: '||(select string_agg(value,'; ') from jsonb_array_elements_text(missing))||'.' else 'Checklist ready. Review and submit the cleaning.' end;
  for recipient in select cleaner_id from public.assignments where job_id=p_job and ended_at is null and cleaner_id<>actor.id loop
   insert into private.cleaning_handoff_notices(job_id,revision,user_id,body) values(p_job,h.revision,recipient,message);
   insert into private.push_messages(logical_key,user_id,kind,job_ids,job_date,expires_at)
    values('handoff:'||p_job||':'||h.revision||':'||recipient,recipient,'handoff',array[p_job],j.checkout_date,now()+interval '7 days');
  end loop;
 end if;
 r:=jsonb_build_object('revision',coalesce(h.revision,0),'draft',h.draft,'senderId',h.sender_id,'senderName',(select display_name from public.users where id=h.sender_id),'missing',case when h.draft is null then '[]'::jsonb else private.handoff_missing(p_job,h.draft) end);
 if p_draft is not null then return private.save_receipt('cleaning_handoff',p_key,input,r);end if;
 return r;
end $$;
create table private.cleaning_handoff_notices(id uuid primary key default gen_random_uuid(),job_id uuid not null references public.jobs,revision integer not null,user_id uuid not null references public.users,body text not null,unique(job_id,revision,user_id));
revoke all on private.cleaning_handoff_notices from public,anon,authenticated,service_role;
alter table private.push_messages drop constraint push_messages_kind_check;
alter table private.push_messages add constraint push_messages_kind_check check(kind in ('new','evening','morning','test','completion','handoff'));
alter function private.inbox_items() rename to inbox_items_before_handoff;
create function private.inbox_items() returns table(id text,body text,href text,dismissible boolean) language plpgsql stable security definer set search_path='' as $$
declare actor public.users;begin
 actor:=private.require_actor();
 return query select * from private.inbox_items_before_handoff();
 return query select 'handoff:'||n.id,n.body,'/cleaner?view=upcoming&date='||j.checkout_date,true
 from private.cleaning_handoff_notices n join public.jobs j on j.id=n.job_id join private.cleaning_handoffs h on h.job_id=j.id and h.revision=n.revision
 where n.user_id=actor.id and j.status='open' and private.assigned(j.id);
end $$;
alter function private.push_content(uuid,timestamptz) rename to push_content_before_handoff;
create function private.push_content(p_message uuid,p_now timestamptz) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m private.push_messages;j public.jobs;n private.cleaning_handoff_notices;begin
 select * into m from private.push_messages where id=p_message;
 if m.kind is distinct from 'handoff' then return private.push_content_before_handoff(p_message,p_now);end if;
 select * into j from public.jobs where id=m.job_ids[1];
 if m.expires_at<=p_now or j.status<>'open' or not exists(select 1 from public.assignments where job_id=j.id and cleaner_id=m.user_id and ended_at is null) then return null;end if;
 select notice.* into n from private.cleaning_handoff_notices notice join private.cleaning_handoffs h on h.job_id=notice.job_id and h.revision=notice.revision
 where notice.job_id=j.id and notice.user_id=m.user_id and m.logical_key='handoff:'||j.id||':'||notice.revision||':'||m.user_id;
 if n.id is null then return null;end if;
 return jsonb_build_object('body',left(n.body,240),'url','/cleaner?view=upcoming&date='||j.checkout_date,'count',1);
end $$;
-- A teammate's newer saved work must be reviewed before completion; keep existing
-- completion validation and idempotent retries inside the original function.
alter function private.complete_cleaning(uuid,jsonb,text) rename to complete_cleaning_before_handoff;
create function private.complete_cleaning(p_job uuid,p_payload jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare revision integer;j public.jobs;begin
 perform 1 from public.properties where id=(select property_id from public.jobs where id=p_job) for update;
 select * into j from public.jobs where id=p_job for update;
 select h.revision into revision from private.cleaning_handoffs h where job_id=p_job;
 if j.status='open' and revision is not null and (p_payload->>'handoffRevision')::integer is distinct from revision then raise exception 'CONFLICT';end if;
 return private.complete_cleaning_before_handoff(p_job,p_payload-'handoffRevision',p_key);
end $$;
revoke all on function private.handoff_missing(uuid,jsonb),private.inbox_items_before_handoff(),private.inbox_items(),private.push_content_before_handoff(uuid,timestamptz),private.push_content(uuid,timestamptz),private.complete_cleaning_before_handoff(uuid,jsonb,text),private.complete_cleaning(uuid,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.bloom_cleaning_handoff(uuid,jsonb,integer,text) from public,anon;
grant execute on function public.bloom_cleaning_handoff(uuid,jsonb,integer,text) to authenticated;
commit;
