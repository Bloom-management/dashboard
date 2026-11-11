begin;
-- Drafts use the same owner/admin boundary while staying outside operational access.
do $$declare def text;begin
 def:=pg_get_functiondef('private.people_access(uuid,uuid)'::regprocedure);
 if position('and p.active' in def)=0 then raise exception 'Expected ownership boundary changed';end if;
 execute replace(def,'and p.active','and (p.active or p.draft_data is not null)');
end$$;
alter table public.jobs add column house_id uuid references public.houses,add column scope_revision integer not null default 1;
create unique index one_house_visit_day on public.jobs(house_id,checkout_date) where house_id is not null;
create table private.room_turnovers(
 id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties,house_id uuid not null references public.houses,
 job_id uuid references public.jobs,event_id uuid unique references public.calendar_events,booking_id uuid unique references private.manual_bookings,
 manual_key text,checkout_date date not null,start_at timestamptz not null,end_at timestamptz not null,
 included boolean not null default false,state text not null default 'pending' check(state in ('pending','accepted','unresolved','cancelled','review')),
 revision integer not null default 1,instructions text not null default '',created_at timestamptz not null default now(),unique(property_id,manual_key),check(end_at>start_at)
);
create table private.room_turnover_history(id uuid primary key default gen_random_uuid(),turnover_id uuid references private.room_turnovers,before_snapshot jsonb,after_snapshot jsonb,created_at timestamptz not null default now());
create function private.room_turnover_audit() returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into private.room_turnover_history(turnover_id,before_snapshot,after_snapshot) values(new.id,case when TG_OP='UPDATE' then to_jsonb(old) end,to_jsonb(new));return new;end$$;
create trigger room_turnover_audit after insert or update on private.room_turnovers for each row execute function private.room_turnover_audit();
create trigger room_turnover_history_immutable before update or delete on private.room_turnover_history for each row execute function private.immutable();
create table private.visit_space_completion(job_id uuid references public.jobs,space_id uuid references public.house_spaces,completed_by uuid references public.users,completed_at timestamptz,primary key(job_id,space_id));
create table private.visit_proposals(
 id uuid primary key default gen_random_uuid(),job_id uuid not null references public.jobs,revision integer not null,
 base_version integer not null,assignment_snapshot text not null,pricing_revision integer not null,turnover_snapshot text not null,
 start_at timestamptz not null,end_at timestamptz not null,pool_cents integer not null,host_cents integer not null,
 room_ids uuid[] not null,state text not null default 'pending' check(state in ('pending','accepted','declined','stale')),created_at timestamptz not null default now(),unique(job_id,revision)
);
create table private.visit_proposal_answers(proposal_id uuid references private.visit_proposals,assignment_id uuid references public.assignments,accepted boolean not null,answered_at timestamptz not null default now(),primary key(proposal_id,assignment_id));
create table private.visit_notices(id uuid primary key default gen_random_uuid(),job_id uuid references public.jobs,user_id uuid references public.users,event_key text not null,body text not null,created_at timestamptz not null default now(),unique(job_id,user_id,event_key));
revoke all on private.room_turnovers,private.room_turnover_history,private.visit_space_completion,private.visit_proposals,private.visit_proposal_answers,private.visit_notices from public,anon,authenticated,service_role;
create function private.visit_assignment_stamp(p_job uuid) returns text language sql stable security definer set search_path='' as $$select coalesce(string_agg(id::text||':'||cleaner_id::text||':'||coalesce(agreed_pay_cents::text,''),',' order by id),'') from public.assignments where job_id=p_job and ended_at is null$$;
create function private.visit_turnover_stamp(p_job uuid) returns text language sql stable security definer set search_path='' as $$select coalesce(string_agg(id::text||':'||revision||':'||state||':'||included,',' order by id),'') from private.room_turnovers where job_id=p_job$$;
create function private.visit_notice(p_job uuid,p_event text,p_body text,p_cleaner uuid default null) returns void language sql security definer set search_path='' as $$
 insert into private.visit_notices(job_id,user_id,event_key,body)
 select p_job,u.id,p_event,case when p_cleaner is null then (select h.name||' · '||to_char(j.checkout_date,'Mon FMDD, YYYY') from public.jobs j join public.houses h on h.id=j.house_id where j.id=p_job)||' · '||p_body else p_body end from public.users u where
 case when p_cleaner is not null then u.id=p_cleaner else u.role='admin' or exists(select 1 from public.property_owners o join public.properties p on p.id=o.property_id join public.jobs j on j.house_id=p.house_id where j.id=p_job and o.owner_id=u.id) end
 on conflict do nothing
$$;
-- One authoritative config: bedroom ids are private physical spaces; shared ids occur once.
create function private.visit_refresh(p_job uuid) returns void language plpgsql security definer set search_path='' as $$
declare j public.jobs;pricing public.house_visit_pricing;n integer;cfg jsonb;s timestamptz;e timestamptz;before_job jsonb;begin
 select * into j from public.jobs where id=p_job for update;before_job:=private.job_snapshot(p_job);if j.status='completed' then raise exception 'INVALID_STATE';end if;
 select count(*),max(start_at),min(end_at) into n,s,e from private.room_turnovers where job_id=p_job and included;
 if n=0 then
 update public.jobs set status='cancelled',version=version+1 where id=p_job;perform private.audit(p_job,'room_scope_empty',before_job,'scope:'||j.scope_revision);return;end if;
 if n>(select count(distinct property_id) from public.house_spaces where house_id=j.house_id and kind='bedroom') or s>=e then raise exception 'REVIEW_REQUIRED';end if;
 select * into pricing from public.house_visit_pricing where house_id=j.house_id;
 select jsonb_build_object('version',j.scope_revision,'supplies','[]'::jsonb,'rooms',coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'label',sp.label,'type',case sp.kind when 'bedroom' then 'bedrooms' when 'bathroom' then 'bathrooms' else sp.kind end,'requiredPhoto',true) order by sp.property_id nulls last,sp.kind,sp.id),'[]')) into cfg
 from public.house_spaces sp where sp.house_id=j.house_id and sp.kind in ('bedroom','bathroom','kitchen','living_room') and
 (sp.property_id is null or exists(select 1 from private.room_turnovers t where t.job_id=p_job and t.included and t.property_id=sp.property_id));
 update public.jobs set start_at=s,end_at=e,solo_rate_cents_snapshot=case when cleaning_management='bloom' then pricing.first_pool_cents+(n-1)*pricing.additional_pool_cents else solo_rate_cents_snapshot end,
 host_charge_cents_snapshot=case when cleaning_management='bloom' then pricing.first_host_cents+(n-1)*pricing.additional_host_cents else host_charge_cents_snapshot end,
 cleaning_config=cfg,setup_required=false,status='open',version=version+1,updated_at=clock_timestamp() where id=p_job;
 perform private.audit(p_job,'room_scope_refreshed',before_job,'scope:'||j.scope_revision,jsonb_build_object('rooms',n));
end$$;
create function private.visit_propose(p_job uuid,p_coordinated boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare j public.jobs;v public.house_visit_pricing;pid uuid;n integer;s timestamptz;e timestamptz;rooms uuid[];a record;oldpay integer;newpay integer;labels text;begin
 select * into j from public.jobs where id=p_job for update;
 if j.status<>'open' or (j.started_at is not null and not p_coordinated) then
 update private.visit_proposals set state='stale' where job_id=p_job and state='pending';
 update private.room_turnovers set state='unresolved',revision=revision+1 where job_id=p_job and not included and state='pending';
 perform private.visit_notice(p_job,'coverage:'||j.scope_revision,'Room coverage needs review.');return null;end if;
 select count(*),max(start_at),min(end_at),array_agg(id order by id) into n,s,e,rooms from private.room_turnovers where job_id=p_job and (included or state='pending');
 if n>(select count(distinct property_id) from public.house_spaces where house_id=j.house_id and kind='bedroom') or s>=e or s<j.start_at or e>j.end_at then
 -- A revised window must fit inside every accepted room's actual window.
 if n>(select count(distinct property_id) from public.house_spaces where house_id=j.house_id and kind='bedroom') or s>=e then
 update private.room_turnovers set state='unresolved',revision=revision+1 where job_id=p_job and not included;
 perform private.visit_notice(p_job,'window:'||j.scope_revision,'Room access windows need review.');return null;end if;end if;
 select * into v from public.house_visit_pricing where house_id=j.house_id;
 update private.visit_proposals set state='stale' where job_id=p_job and state='pending';
 update public.jobs set scope_revision=scope_revision+1,version=version+1 where id=p_job returning * into j;
 insert into private.visit_proposals(job_id,revision,base_version,assignment_snapshot,pricing_revision,turnover_snapshot,start_at,end_at,pool_cents,host_cents,room_ids)
 values(p_job,j.scope_revision,j.version,private.visit_assignment_stamp(p_job),v.revision,private.visit_turnover_stamp(p_job),s,e,case when j.cleaning_management='bloom' then v.first_pool_cents+(n-1)*v.additional_pool_cents else j.private_total_cents_snapshot end,coalesce(case when j.cleaning_management='bloom' then v.first_host_cents+(n-1)*v.additional_host_cents else j.host_charge_cents_snapshot end,0),rooms) returning id into pid;
 select string_agg(p.room_identifier,' & ' order by p.room_identifier) into labels from private.room_turnovers t join public.properties p on p.id=t.property_id where t.job_id=p_job and not t.included and t.state='pending';
 for a in select * from public.assignments where job_id=p_job and ended_at is null loop
 oldpay:=(case when j.cleaning_management='private' then j.private_total_cents_snapshot else j.solo_rate_cents_snapshot end)/(select count(*) from public.assignments where job_id=p_job and ended_at is null);
 newpay:=(case when j.cleaning_management='private' then j.private_total_cents_snapshot else v.first_pool_cents+(n-1)*v.additional_pool_cents end)/(select count(*) from public.assignments where job_id=p_job and ended_at is null);
 if j.cleaning_management='private' and j.compensation_mode='individual' then oldpay:=a.agreed_pay_cents;newpay:=a.agreed_pay_cents;end if;
 perform private.visit_notice(p_job,'proposal:'||pid,labels||' was added to your '||(select name from public.houses where id=j.house_id)||' cleaning request. '||case when newpay=oldpay then 'Your payout would remain $'||to_char(newpay/100.0,'FM999990.00')||'.' else 'Your total payout would '||case when newpay>oldpay then 'increase' else 'decrease' end||' from $'||to_char(oldpay/100.0,'FM999990.00')||' to $'||to_char(newpay/100.0,'FM999990.00')||'.' end,a.cleaner_id);
 end loop;
 perform private.visit_notice(p_job,'coverage:'||pid,'Added room coverage is awaiting cleaner acceptance.');return pid;
end$$;
-- All callers hold the house lock before touching a visit. Reservation identities never use dates as keys.
create function private.room_turnover_attach(p_property uuid,p_day date,p_start timestamptz,p_end timestamptz,p_event uuid default null,p_booking uuid default null,p_manual text default null,p_instructions text default '',p_coordinated boolean default false,p_config jsonb default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.properties;j public.jobs;t private.room_turnovers;other private.room_turnovers;pricing public.house_visit_pricing;claimed boolean;begin
 select * into p from public.properties where id=p_property;
 if p.listing_type<>'room' or not p.active or p.draft_data is not null or p.deleted_at is not null or p.room_identifier is null then raise exception 'REVIEW_REQUIRED';end if;
 if (p_start at time zone p.timezone)::date<>p_day or (p_end at time zone p.timezone)::date<>p_day or p_end<=p_start then raise exception 'VALIDATION_ERROR';end if;
 perform pg_advisory_xact_lock(hashtextextended('house-visit:'||p.house_id,0));
 select * into t from private.room_turnovers where (p_event is not null and event_id=p_event) or (p_booking is not null and booking_id=p_booking) or (p_manual is not null and property_id=p.id and manual_key=p_manual) for update;
 if t.id is not null then
 if not t.included and t.state='unresolved' and not p_coordinated then update private.room_turnovers set checkout_date=p_day,start_at=p_start,end_at=p_end,revision=revision+1 where id=t.id;return t.job_id;end if;
 if t.checkout_date=p_day and t.start_at=p_start and t.end_at=p_end and t.state in ('accepted','pending') and exists(select 1 from public.jobs where id=t.job_id and checkout_date=p_day) then return t.job_id;end if;
 if t.included and (exists(select 1 from public.jobs where id=t.job_id and (status='completed' or started_at is not null)) or exists(select 1 from public.assignments where job_id=t.job_id and ended_at is null)) then
 update private.room_turnovers set checkout_date=p_day,start_at=p_start,end_at=p_end,state='review',revision=revision+1 where id=t.id;
 if (select status from public.jobs where id=t.job_id)<>'completed' then update public.jobs set review_required=true,version=version+1 where id=t.job_id;end if;
 perform private.visit_notice(t.job_id,'extension:'||t.id||':'||(t.revision+1),'Room dates changed. Review the accepted scope and coverage.');return t.job_id;end if;
 update private.room_turnovers set included=false,state='pending',revision=revision+1 where id=t.id;
 if t.included then perform private.visit_refresh(t.job_id);end if;
 end if;
 select * into j from public.jobs where house_id=p.house_id and checkout_date=p_day for update;
 if j.id is not null and j.status='cancelled' and j.cancellation_origin='admin' and not p_coordinated then
 if t.id is null then insert into private.room_turnovers(property_id,house_id,job_id,event_id,booking_id,manual_key,checkout_date,start_at,end_at,state,instructions) values(p.id,p.house_id,j.id,p_event,p_booking,p_manual,p_day,p_start,p_end,'unresolved',p_instructions);else update private.room_turnovers set state='unresolved',revision=revision+1 where id=t.id;end if;
 perform private.visit_notice(j.id,'cancelled-room:'||p.id,'A cancelled visit has a room booking update. Review coverage.');return j.id;end if;
 if j.id is not null and j.status='completed' then
 if t.id is null then insert into private.room_turnovers(property_id,house_id,job_id,event_id,booking_id,manual_key,checkout_date,start_at,end_at,state,instructions) values(p.id,p.house_id,j.id,p_event,p_booking,p_manual,p_day,p_start,p_end,'unresolved',p_instructions);end if;
 perform private.visit_notice(j.id,'late-room:'||p.id,'A room needs coverage after the visit was completed. Review without changing earned pay.');return j.id;end if;
 select * into pricing from public.house_visit_pricing where house_id=p.house_id;if pricing.house_id is null then raise exception 'CONFIGURATION_ERROR';end if;
 if j.id is null then
 insert into public.jobs(property_id,house_id,checkout_date,start_at,end_at,timezone_snapshot,solo_rate_cents_snapshot,creation_origin,manual_config,job_instructions)
 values(p.id,p.house_id,p_day,p_start,p_end,p.timezone,pricing.first_pool_cents,case when p_event is not null then 'imported' when p_booking is not null then 'manual_booking' else 'manual_cleaning' end,p_config,p_instructions) returning * into j;
 end if;
 if exists(select 1 from private.room_turnovers where job_id=j.id and property_id=p.id and id is distinct from t.id and state<>'cancelled') then raise exception 'CONFLICT';end if;
 claimed:=exists(select 1 from public.assignments where job_id=j.id and ended_at is null);
 if t.id is null then
 insert into private.room_turnovers(property_id,house_id,job_id,event_id,booking_id,manual_key,checkout_date,start_at,end_at,instructions)
 values(p.id,p.house_id,j.id,p_event,p_booking,p_manual,p_day,p_start,p_end,coalesce(nullif(p_instructions,''),(select instructions from public.property_entry_instructions where property_id=p.id),'')) returning * into t;
 else update private.room_turnovers set job_id=j.id,checkout_date=p_day,start_at=p_start,end_at=p_end,state='pending',instructions=p_instructions,revision=revision+1 where id=t.id returning * into t;end if;
 if (j.property_id<>p.id and not exists(select 1 from public.property_owners a join public.property_owners b on b.owner_id=a.owner_id where a.property_id=j.property_id and b.property_id=p.id) and not (p.is_bloom_owned and (select is_bloom_owned from public.properties where id=j.property_id))) or (j.cleaning_management='private' and exists(select 1 from public.assignments a where a.job_id=j.id and a.ended_at is null and not private.team_member(p.id,a.cleaner_id))) or j.cleaning_management<>coalesce(p_config->>'management',p.cleaning_management) or (j.cleaning_management='private' and j.property_id<>p.id and not exists(select 1 from public.properties anchor where anchor.id=j.property_id and anchor.private_payer_id is not distinct from p.private_payer_id and anchor.private_capacity=p.private_capacity and anchor.private_total_cents=p.private_total_cents))
 or exists(select 1 from private.room_turnovers a where a.job_id=j.id and a.included and (greatest(a.start_at,p_start)>=least(a.end_at,p_end))) then
 update private.room_turnovers set state='unresolved',revision=revision+1 where id=t.id;
 perform private.visit_notice(j.id,'window:'||t.id,'Room configuration or access windows need review.');return j.id;end if;
 if not claimed and j.started_at is null then
 update private.room_turnovers set included=true,state='accepted',revision=revision+1 where id=t.id;
 update public.jobs set scope_revision=scope_revision+1 where id=j.id;perform private.visit_refresh(j.id);
 else perform private.visit_propose(j.id,p_coordinated);end if;
 return j.id;
end$$;
create function private.visit_initial_setup() returns trigger language plpgsql security definer set search_path='' as $$begin if new.house_id is not null then new.setup_required:=true;end if;return new;end$$;
create trigger zz_visit_initial_setup before insert on public.jobs for each row execute function private.visit_initial_setup();
do $$declare def text;begin
 def:=pg_get_functiondef('private.guard_job()'::regprocedure);
 def:=replace(def,'if new.creation_origin<>''imported'' or new.manual_date_override then','if new.house_id is not null or new.creation_origin<>''imported'' or new.manual_date_override then');execute def;
end$$;
-- Draft calendars remain prohibited; active rooms use the grouped path exclusively.
create or replace function private.draft_operational_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from public.properties where id=new.property_id and draft_data is not null) then raise exception 'REVIEW_REQUIRED';end if;
 if TG_TABLE_NAME='jobs' then if exists(select 1 from public.properties where id=new.property_id and listing_type='room' and house_id is distinct from new.house_id) then raise exception 'REVIEW_REQUIRED';end if;end if;
 return new;end$$;
alter function private.job_dto(uuid) rename to job_dto_before_room_visits;
create function private.job_dto(p_job uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select private.job_dto_before_room_visits(p_job)||case when j.house_id is null then '{}'::jsonb else jsonb_build_object('houseId',j.house_id,'scopeRevision',j.scope_revision,'propertyName',h.name||' · '||coalesce((select string_agg(p.room_identifier,' & ' order by p.room_identifier) from private.room_turnovers t join public.properties p on p.id=t.property_id where t.job_id=j.id and t.included),'Review'), 'propertyIds',coalesce((select jsonb_agg(t.property_id) from private.room_turnovers t where t.job_id=j.id and t.included),'[]'),'roomIdentifiers',coalesce((select jsonb_agg(p.room_identifier order by p.room_identifier) from private.room_turnovers t join public.properties p on p.id=t.property_id where t.job_id=j.id and t.included),'[]')) end
 from public.jobs j left join public.houses h on h.id=j.house_id where j.id=p_job
$$;
create function private.visit_access(p_job uuid,p_manage boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.jobs j where j.id=p_job and j.house_id is not null and
 (private.is_admin() or (not p_manage and private.assigned(j.id)) or exists(select 1 from public.property_owners o where o.property_id=j.property_id and o.owner_id=(private.actor()).id and not exists(select 1 from private.room_turnovers rt where rt.job_id=j.id and rt.included and not private.people_access(rt.property_id,o.owner_id)))))
$$;
create function public.bloom_room_visit(p_job uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u public.users;j public.jobs;manager boolean;begin
 u:=private.require_actor();select * into j from public.jobs where id=p_job;
 if not private.visit_access(p_job) then raise exception 'NOT_FOUND';end if;
 manager:=private.visit_access(p_job,true);
 return jsonb_build_object('job',private.job_dto(p_job),'startedAt',j.started_at,'canManage',manager,'hostChargeCents',case when manager then j.host_charge_cents_snapshot end,
 'rooms',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'propertyId',p.id,'identifier',p.room_identifier,'included',t.included,'state',t.state,'date',t.checkout_date,
 'instructions',case when (t.included and private.assigned(p_job)) or private.people_access(p.id,u.id) then t.instructions end,
 'access',case when (t.included and j.status='open' and private.assigned(p_job)) or private.people_access(p.id,u.id) then (select access_info from public.property_entry_instructions ai where ai.property_id=p.id) end) order by p.room_identifier),'[]') from private.room_turnovers t join public.properties p on p.id=t.property_id where t.job_id=p_job and (t.included or (manager and private.people_access(p.id,u.id)))),
 'spaces',(select coalesce(jsonb_agg(room||jsonb_build_object('done',c.completed_at is not null,'scope',case when sp.property_id is null then 'shared' else 'room' end,'propertyId',sp.property_id) order by ordinal),'[]') from jsonb_array_elements(j.cleaning_config->'rooms') with ordinality a(room,ordinal) join public.house_spaces sp on sp.id=(room->>'id')::uuid left join private.visit_space_completion c on c.job_id=p_job and c.space_id=sp.id),
 'proposals',(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'revision',v.revision,'state',v.state,'oldPoolCents',case when j.cleaning_management='private' then j.private_total_cents_snapshot else j.solo_rate_cents_snapshot end,'newPoolCents',v.pool_cents,'myAnswer',(select accepted from private.visit_proposal_answers where proposal_id=v.id and assignment_id=(select id from public.assignments where job_id=p_job and cleaner_id=u.id and ended_at is null)),'rooms',(select jsonb_agg(p.room_identifier order by p.room_identifier) from private.room_turnovers t join public.properties p on p.id=t.property_id where t.id=any(v.room_ids))) order by v.revision desc),'[]') from private.visit_proposals v where v.job_id=p_job and (v.state='pending' or manager)));
end$$;
-- Job/assignment locks protect scope consent and the original agreed workload.
create function public.bloom_room_visit_action(p_job uuid,p_action text,p_data jsonb,p_version integer,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;j public.jobs;v private.visit_proposals;a public.assignments;r jsonb;input jsonb:=jsonb_build_object('job',p_job,'action',p_action,'data',p_data,'version',p_version);begin
 u:=private.require_actor();select * into j from public.jobs where id=p_job;
 if not private.visit_access(p_job) then raise exception 'NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('house-visit:'||j.house_id,0));
 select * into j from public.jobs where id=p_job for update;
 r:=private.receipt('room_visit_action',p_key,input);if r is not null then return r;end if;
 if j.version is distinct from p_version or j.status<>'open' then raise exception 'CONFLICT';end if;
 if p_action='space' then
 if not private.assigned(j.id) or j.started_at is null or j.review_required then raise exception 'NOT_FOUND';end if;
 if not exists(select 1 from jsonb_array_elements(j.cleaning_config->'rooms') x where x->>'id'=p_data->>'spaceId') or jsonb_typeof(p_data->'done') is distinct from 'boolean' then raise exception 'VALIDATION_ERROR';end if;
 insert into private.visit_space_completion(job_id,space_id,completed_by,completed_at) values(j.id,(p_data->>'spaceId')::uuid,u.id,case when (p_data->>'done')::boolean then now() end)
 on conflict(job_id,space_id) do update set completed_by=u.id,completed_at=excluded.completed_at;
 elsif p_action in ('accept','decline') then
 select * into a from public.assignments where job_id=j.id and cleaner_id=u.id and ended_at is null;
 select * into v from private.visit_proposals where id=(p_data->>'proposalId')::uuid and job_id=j.id for update;
 if a.id is null or v.id is null then raise exception 'NOT_FOUND';end if;
 if v.base_version<>j.version or v.state<>'pending' or v.revision<>j.scope_revision or v.assignment_snapshot<>private.visit_assignment_stamp(j.id) or v.turnover_snapshot<>private.visit_turnover_stamp(j.id) or v.pricing_revision<>(select revision from public.house_visit_pricing where house_id=j.house_id) then raise exception 'CONFLICT';end if;
 insert into private.visit_proposal_answers(proposal_id,assignment_id,accepted) values(v.id,a.id,p_action='accept') on conflict do nothing;
 if p_action='decline' then
 update private.visit_proposals set state='declined' where id=v.id;
 update private.room_turnovers set state='unresolved',revision=revision+1 where job_id=j.id and not included;
 perform private.visit_notice(j.id,'declined:'||v.id,'An added room was declined. Original assignments and payouts are unchanged. Review room coverage.');
 elsif not exists(select 1 from public.assignments x where x.job_id=j.id and x.ended_at is null and not exists(select 1 from private.visit_proposal_answers ans where ans.proposal_id=v.id and ans.assignment_id=x.id and ans.accepted)) then
 update private.room_turnovers set included=true,state='accepted',revision=revision+1 where id=any(v.room_ids);
 -- Capture the accepted offer's prices; subsequent rule edits never reprice this agreement.
 perform private.visit_refresh(j.id);
 update public.jobs set solo_rate_cents_snapshot=v.pool_cents,host_charge_cents_snapshot=v.host_cents,start_at=v.start_at,end_at=v.end_at where id=j.id;
 update private.visit_proposals set state='accepted' where id=v.id;
 end if;
 elsif p_action='cancel_visit' then
 if not private.visit_access(j.id,true) or j.started_at is not null then raise exception 'FORBIDDEN';end if;
 update public.assignments set ended_at=now(),end_reason='cancelled' where job_id=j.id and ended_at is null;
 update public.jobs set status='cancelled',cancellation_origin='admin',version=version+1 where id=j.id;
 update private.room_turnovers set included=false,state='cancelled',revision=revision+1 where job_id=j.id;
 update private.visit_proposals set state='stale' where job_id=j.id and state='pending';
 elsif p_action='coordinate' then
 if not private.visit_access(j.id,true) then raise exception 'FORBIDDEN';end if;
 update private.room_turnovers set state='pending',revision=revision+1 where job_id=j.id and not included and state='unresolved';perform private.visit_propose(j.id,true);
 else raise exception 'VALIDATION_ERROR';end if;
 perform private.audit(j.id,'room_visit_'||p_action,null,p_key,p_data);
 return private.save_receipt('room_visit_action',p_key,input,public.bloom_room_visit(j.id));
end$$;
create function private.complete_room_visit(p_job uuid,p_payload jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;j public.jobs;r jsonb;input jsonb:=jsonb_build_object('job',p_job,'payload',p_payload);eventid uuid;begin
 u:=private.require_actor();if not private.assigned(p_job) then raise exception 'NOT_FOUND';end if;
 r:=private.receipt('room_visit_complete',p_key,input);if r is not null then return r;end if;
 select * into j from public.jobs where id=p_job for update;
 if j.status='completed' then return private.save_receipt('room_visit_complete',p_key,input,jsonb_build_object('job',private.job_dto(j.id),'receipt',j.completion_receipt));end if;
 if j.status<>'open' or j.started_at is null or j.start_at>now() then raise exception 'INVALID_STATE';end if;
 if j.review_required then raise exception 'REVIEW_REQUIRED';end if;
 if (p_payload->>'configVersion')::integer is distinct from j.scope_revision then raise exception 'CONFLICT';end if;
 if jsonb_typeof(p_payload->'notes') is distinct from 'string' or length(p_payload->>'notes')>1500 or (p_payload->'guestReview'->>'rating')::integer not between 1 and 5 or p_payload->'guestReview'->>'rating' is null or length(coalesce(p_payload->'guestReview'->>'comment',''))>1500 then raise exception 'VALIDATION_ERROR';end if;
 r:=jsonb_build_object('jobId',j.id,'completedAt',clock_timestamp(),'completedBy',u.id,'notes',p_payload->>'notes','guestReview',p_payload->'guestReview','maintenance','[]'::jsonb,
 'reports',(select coalesce(jsonb_agg(jsonb_build_object('supplyId',i.id,'name',i.name,'level',rep.value)),'[]') from public.house_items i join lateral (select value from public.house_item_reports where item_id=i.id and job_id=j.id order by revision desc limit 1) rep on true where i.kind='supply' and i.house_id=j.house_id and (i.property_id is null or exists(select 1 from private.room_turnovers scope where scope.job_id=j.id and scope.included and scope.property_id=i.property_id))),
 'houseReports',(select coalesce(jsonb_agg(to_jsonb(rep)),'[]') from public.house_item_reports rep join public.house_items item on item.id=rep.item_id where rep.job_id=j.id and (item.property_id is null or exists(select 1 from private.room_turnovers scope where scope.job_id=j.id and scope.included and scope.property_id=item.property_id))));
 insert into public.admin_notification_events(job_id,event_type,payload) values(j.id,'job.completed',r) returning id into eventid;
 r:=r||jsonb_build_object('eventId',eventid);
 update public.jobs set completion_receipt=r where id=j.id;
 perform private.job_action_v1(j.id,'complete',p_key);
 return private.save_receipt('room_visit_complete',p_key,input,jsonb_build_object('job',private.job_dto(j.id),'receipt',r));
end$$;

-- Existing mutation endpoints remain authoritative. Whole-visit claims reuse their row locks/capacity checks.
alter function public.bloom_job_action(uuid,text,text,integer,jsonb) rename to bloom_job_action_before_room_visits;
create function public.bloom_job_action(p_job uuid,p_action text,p_key text,p_expected_version integer default null,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.jobs;r jsonb;u public.users;input jsonb:=jsonb_build_object('job',p_job,'action',p_action,'version',p_expected_version,'payload',p_payload);begin
 u:=private.require_actor();select * into j from public.jobs where id=p_job;
 if j.house_id is not null then
 if p_action in ('cancel','reassign','keep','reschedule') then perform private.require_actor('admin');elsif u.role not in ('cleaner','admin') then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('house-visit:'||j.house_id,0));
 select * into j from public.jobs where id=p_job for update;
 if p_action<>'complete' then r:=private.receipt('room_job_action',p_key,input);if r is not null then return r;end if;end if;
 if p_action='reschedule' then raise exception 'REVIEW_REQUIRED';end if;
 if p_action='keep' and exists(select 1 from private.room_turnovers where job_id=j.id and state='review') then raise exception 'REVIEW_REQUIRED';end if;
 if p_action='claim' and j.started_at is not null then raise exception 'INVALID_STATE';end if;
 if p_action='complete' and j.status<>'completed' then
 if exists(select 1 from jsonb_array_elements(j.cleaning_config->'rooms') x where not exists(select 1 from private.visit_space_completion c where c.job_id=j.id and c.space_id=(x->>'id')::uuid and c.completed_at is not null)) then raise exception 'INVALID_STATE';end if;
 if exists(select 1 from public.house_items i where i.house_id=j.house_id and i.active and (i.property_id is null or exists(select 1 from private.room_turnovers t where t.job_id=j.id and t.included and t.property_id=i.property_id)) and not exists(select 1 from public.house_item_reports r where r.item_id=i.id and r.job_id=j.id)) then raise exception 'VALIDATION_ERROR';end if;
 end if;
 end if;
 if j.house_id is not null and p_action='complete' then return private.complete_room_visit(p_job,p_payload,p_key);end if;
 r:=public.bloom_job_action_before_room_visits(p_job,p_action,p_key,p_expected_version,p_payload);
 if j.house_id is not null and p_action in ('claim','withdraw','reassign','cancel') then
 update private.visit_proposals set state='stale' where job_id=j.id and state='pending';
 if p_action='cancel' then update private.room_turnovers set included=false,state='cancelled',revision=revision+1 where job_id=j.id;
 elsif p_action in ('claim','withdraw') and exists(select 1 from public.assignments where job_id=j.id and ended_at is null) and exists(select 1 from private.room_turnovers where job_id=j.id and state='pending' and not included) then perform private.visit_propose(j.id);end if;
 end if;
 if j.house_id is not null then return private.save_receipt('room_job_action',p_key,input,private.job_dto(j.id));end if;
 return r;
end$$;
-- Existing manual booking creation reaches this function; each booking retains its own turnover.
alter function private.manual_create_job(uuid,date,jsonb,text,uuid) rename to manual_create_job_before_room_visits;
do $$declare def text;needle text;begin
 def:=pg_get_functiondef('private.manual_create_job_before_room_visits(uuid,date,jsonb,text,uuid)'::regprocedure);
 def:=replace(def,'FUNCTION private.manual_create_job_before_room_visits(','FUNCTION private.manual_create_job(');
 def:=replace(def,'p:=private.manual_property(p_property);u:=private.require_actor();',
 'if (select listing_type from public.properties where id=p_property)<>''room'' then return private.manual_create_job_before_room_visits(p_property,p_day,p_data,p_origin,p_booking);end if; p:=private.manual_property(p_property);u:=private.require_actor();');
 needle:=substring(def from 'insert into public.jobs[\s\S]+?returning jobs.id into created_job_id;');
 if needle is null then raise exception 'Manual cleaning insertion not found';end if;
 def:=replace(def,needle,'if p_booking is not null and p_origin=''manual_booking'' then w:=private.manual_window(p_day,greatest(p.cleaning_start_time,(select checkout_time from private.manual_bookings where id=p_booking)),p.cleaning_end_time,p.timezone);end if; created_job_id:=private.room_turnover_attach(p.id,p_day,lower(w),upper(w),null,p_booking,case when p_booking is null then gen_random_uuid()::text end,coalesce(p_data->>''instructions'',''''),true,cfg);');
 execute def;
end$$;
create function private.room_turnover_cancel(p_turnover uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare t private.room_turnovers;j public.jobs;begin
 select * into t from private.room_turnovers where id=p_turnover;
 perform pg_advisory_xact_lock(hashtextextended('house-visit:'||t.house_id,0));
 select * into j from public.jobs where id=t.job_id for update;
 if j.status='completed' then
 update private.room_turnovers set state='review',revision=revision+1 where id=t.id;perform private.visit_notice(j.id,'completed-change:'||t.id||':'||t.revision,'A completed visit has a booking change. Review its history.');return;end if;
 if t.included and (j.started_at is not null or exists(select 1 from public.assignments where job_id=j.id and ended_at is null)) then
 update private.room_turnovers set state='review',revision=revision+1 where id=t.id;update public.jobs set review_required=true,version=version+1 where id=j.id;
 perform private.visit_notice(j.id,'removal:'||t.id||':'||t.revision,'A room was cancelled. Review the accepted scope and payout.');
 else update private.room_turnovers set included=false,state='cancelled',revision=revision+1 where id=t.id;if t.included then perform private.visit_refresh(j.id);end if;end if;
 update private.visit_proposals set state='stale' where job_id=j.id and state='pending';
end$$;
create function private.room_booking_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare t private.room_turnovers;p public.properties;begin
 select * into t from private.room_turnovers where booking_id=new.id;if t.id is null then return new;end if;
 if new.status='cancelled' then perform private.room_turnover_cancel(t.id,'booking cancelled');
 elsif new.checkout<>old.checkout then
 select * into p from public.properties where id=new.property_id;
 perform private.room_turnover_attach(p.id,new.checkout,(new.checkout+greatest(p.cleaning_start_time,new.checkout_time)) at time zone p.timezone,(new.checkout+p.cleaning_end_time) at time zone p.timezone,null,new.id);
 end if;return new;
end$$;
create trigger room_booking_changed after update on private.manual_bookings for each row execute function private.room_booking_changed();
-- Keep the original function OID so existing photo/storage policies use the new room boundary.
do $$declare def text;begin
 def:=pg_get_functiondef('private.photo_access(uuid,boolean)'::regprocedure);
 execute replace(def,'FUNCTION private.photo_access(','FUNCTION private.photo_access_before_room_visits(');
end$$;
create or replace function private.photo_access(p_job uuid,p_write boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.jobs where id=p_job and house_id is not null) then
 exists(select 1 from public.jobs j where j.id=p_job and case when p_write then j.status='open' and not j.review_required and private.assigned(j.id)
 else private.is_admin() or private.assigned(j.id) or ((private.actor()).role='owner' and private.visit_access(j.id,true)) end)
 else private.photo_access_before_room_visits(p_job,p_write) end
$$;
revoke all on function private.photo_access_before_room_visits(uuid,boolean) from public,anon,authenticated,service_role;
-- Source ingestion keeps reservations/history in the existing tables and routes only eligible room turnovers.
alter function private.calendar_apply(uuid,uuid,uuid,jsonb) rename to calendar_apply_before_room_visits;
create function private.calendar_apply(p_source uuid,p_run uuid,p_actor uuid,p_snapshot jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.properties;item jsonb;e public.calendar_events;old_e public.calendar_events;t private.room_turnovers;jid uuid;created integer:=0;updated integer:=0;removed integer:=0;unchanged integer:=0;review_count integer:=0;begin
 select prop.* into p from public.properties prop join public.calendar_sources s on s.property_id=prop.id where s.id=p_source;
 if p.listing_type<>'room' then return private.calendar_apply_before_room_visits(p_source,p_run,p_actor,p_snapshot);end if;
 perform pg_advisory_xact_lock(hashtextextended('house-visit:'||p.house_id,0));
 for item in select value from jsonb_array_elements(p_snapshot->'events') loop
 select * into old_e from public.calendar_events where source_id=p_source and uid=item->>'uid' and recurrence_key=item->>'recurrenceKey';
 if old_e.id is not null and private.calendar_event_value(old_e)=item and old_e.missing_reason is null then update public.calendar_events set last_seen_run_id=p_run where id=old_e.id;unchanged:=unchanged+1;
 if not exists(select 1 from private.room_turnovers where event_id=old_e.id) then
 if old_e.source_status='active' and private.calendar_job_eligible(old_e) then
 jid:=private.room_turnover_attach(p.id,old_e.end_local_date,(old_e.end_local_date+greatest(p.cleaning_start_time,p.default_checkout_time)) at time zone p.timezone,(old_e.end_local_date+p.cleaning_end_time) at time zone p.timezone,old_e.id);
 insert into public.job_events(job_id,event_id) values(jid,old_e.id) on conflict do nothing;
 elsif old_e.kind='reservation' and (old_e.review_required or private.manual_import_conflict(old_e.id)) then
 if private.calendar_notice(old_e.id,null,p_run,'conflict','room_booking_review') then review_count:=review_count+1;end if;
 end if;end if;continue;end if;
 if old_e.id is null then
 insert into public.calendar_events(source_id,uid,recurrence_key,start_local_date,end_local_date,kind,content_hash,event_status,source_status,evidence,review_required,last_seen_run_id)
 values(p_source,item->>'uid',item->>'recurrenceKey',(item->>'startDate')::date,(item->>'endDate')::date,item->>'kind',item->>'contentHash',item->>'status',case when item->>'status'='cancelled' then 'removed' else 'active' end,item->>'evidence',(item->>'reviewRequired')::boolean,p_run) returning * into e;created:=created+1;
 else
 update public.calendar_events set start_local_date=(item->>'startDate')::date,end_local_date=(item->>'endDate')::date,kind=item->>'kind',content_hash=item->>'contentHash',event_status=item->>'status',source_status=case when item->>'status'='cancelled' then 'removed' else 'active' end,evidence=item->>'evidence',review_required=(item->>'reviewRequired')::boolean,missing_reason=null,last_seen_run_id=p_run,transition_version=transition_version+1,updated_at=clock_timestamp() where id=old_e.id returning * into e;updated:=updated+1;
 end if;
 insert into public.calendar_event_history(event_id,run_id,before_snapshot,after_snapshot) values(e.id,p_run,coalesce(to_jsonb(old_e),'{}'),to_jsonb(e));
 select * into t from private.room_turnovers where event_id=e.id;
 if e.event_status='cancelled' then
 if t.id is not null then perform private.room_turnover_cancel(t.id,'calendar cancellation');end if;removed:=removed+1;
 elsif private.calendar_job_eligible(e) and e.source_status='active' then
 jid:=private.room_turnover_attach(p.id,e.end_local_date,(e.end_local_date+greatest(p.cleaning_start_time,p.default_checkout_time)) at time zone p.timezone,(e.end_local_date+p.cleaning_end_time) at time zone p.timezone,e.id);
 insert into public.job_events(job_id,event_id) values(jid,e.id) on conflict do nothing;
 elsif t.id is not null then
 update private.room_turnovers set state='review',revision=revision+1 where id=t.id;
 update public.jobs set review_required=true,version=version+1 where id=t.job_id and status<>'completed';
 perform private.visit_notice(t.job_id,'unconfirmed:'||e.id||':'||e.transition_version,'Room booking changes need review.');
 elsif e.kind='reservation' and (e.review_required or private.manual_import_conflict(e.id)) then
 if private.calendar_notice(e.id,null,p_run,'conflict','room_booking_review') then review_count:=review_count+1;end if;
 end if;
 end loop;
 for old_e in select * from public.calendar_events where source_id=p_source and source_status='active' and last_seen_run_id is distinct from p_run and coalesce((p_snapshot->>'complete')::boolean,false) loop
 update public.calendar_events set source_status='removed',missing_reason='horizon_unknown',transition_version=transition_version+1 where id=old_e.id returning * into e;
 insert into public.calendar_event_history(event_id,run_id,before_snapshot,after_snapshot) values(e.id,p_run,to_jsonb(old_e),to_jsonb(e));
 select * into t from private.room_turnovers where event_id=e.id;
 if t.id is not null then
 update private.room_turnovers set state='review',revision=revision+1 where id=t.id;
 update public.jobs set review_required=true,version=version+1 where id=t.job_id and status<>'completed';
 perform private.visit_notice(t.job_id,'missing:'||e.id||':'||e.transition_version,'Room booking confirmation needs review.');end if;removed:=removed+1;
 end loop;
 return jsonb_build_object('runId',p_run,'created',created,'updated',updated,'removed',removed,'unchanged',unchanged,'conflicts',review_count+(select count(*) from private.room_turnovers where house_id=p.house_id and state in ('review','unresolved')),'status','success');
end$$;
-- Acquire the shared lock before legacy property locks, including manual date changes.
alter function public.bloom_calendar_finish_sync(uuid,uuid,uuid,bigint,jsonb,jsonb) rename to bloom_calendar_finish_before_visits;
create function public.bloom_calendar_finish_sync(p_actor uuid,p_source uuid,p_run uuid,p_version bigint,p_snapshot jsonb,p_validators jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$declare hid uuid;begin
 select p.house_id into hid from public.properties p join public.calendar_sources s on s.property_id=p.id where s.id=p_source;
 if hid is not null then perform pg_advisory_xact_lock(hashtextextended('house-visit:'||hid,0));end if;
 return public.bloom_calendar_finish_before_visits(p_actor,p_source,p_run,p_version,p_snapshot,p_validators);
end$$;
alter function public.bloom_property_calendar_action(uuid,text,jsonb,text) rename to bloom_property_calendar_before_visits;
create function public.bloom_property_calendar_action(p_property uuid,p_action text,p_data jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$declare hid uuid;begin
 select house_id into hid from public.properties where id=p_property;
 if hid is not null then perform pg_advisory_xact_lock(hashtextextended('house-visit:'||hid,0));if p_action='move_cleaning' then raise exception 'REVIEW_REQUIRED';end if;end if;
 return public.bloom_property_calendar_before_visits(p_property,p_action,p_data,p_key);
end$$;
alter function private.entry_access(uuid) rename to entry_access_before_visits;
create function private.entry_access(p_property uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.entry_access_before_visits(p_property) or exists(select 1 from private.room_turnovers t join public.jobs j on j.id=t.job_id where t.property_id=p_property and t.included and j.status='open' and private.assigned(j.id))
$$;
-- The shared stock RPC uses included rooms, never house membership alone, for cleaner access.
do $$declare def text;begin
 def:=pg_get_functiondef('public.bloom_house_items(uuid,uuid,text,text,integer,uuid,text)'::regprocedure);
 def:=replace(def,'j.property_id=p.id and j.status=','(j.property_id=p.id or exists(select 1 from private.room_turnovers rt where rt.job_id=j.id and rt.property_id=p.id and rt.included)) and j.status=');
 execute def;
end$$;
create function private.visit_item_notice() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.job_id is not null and new.value in ('issue','low','empty','not_found') then
 perform private.visit_notice(new.job_id,'item-attention:'||new.item_id,(select name from public.house_items where id=new.item_id)||' needs attention.');end if;return new;
end$$;
create trigger visit_item_notice after insert on public.house_item_reports for each row execute function private.visit_item_notice();
alter function private.inbox_items() rename to inbox_items_before_visits;
create function private.inbox_items() returns table(id text,body text,href text,dismissible boolean) language sql stable security definer set search_path='' as $$
 select * from private.inbox_items_before_visits()
 union all select 'room-visit:'||n.id,n.body,case when (private.actor()).role='owner' then '/owner?view=listings&property='||j.property_id when (private.actor()).role='admin' then '/admin?view=jobs&job='||j.id||'&date='||j.checkout_date else '/cleaner?job='||n.job_id||'&date='||j.checkout_date end,true
 from private.visit_notices n join public.jobs j on j.id=n.job_id where n.user_id=(private.actor()).id and private.visit_access(j.id)
$$;
alter function public.bloom_property_pin(uuid,jsonb) rename to bloom_property_pin_before_visits;
create function public.bloom_property_pin(p_property uuid,p_pin jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;hid uuid;begin
 u:=private.require_actor('admin');select house_id into hid from public.properties where id=p_property and deleted_at is null;
 if hid is null then return public.bloom_property_pin_before_visits(p_property,p_pin);end if;
 if p_pin is not null then
 if p_pin='null'::jsonb then update public.houses set latitude=null,longitude=null,pin_confirmed_by=null,pin_confirmed_at=null where id=hid;
 else
 if jsonb_typeof(p_pin->'latitude') is distinct from 'number' or jsonb_typeof(p_pin->'longitude') is distinct from 'number' or p_pin->'confirmed' is distinct from 'true'::jsonb or (p_pin->>'latitude')::double precision not between -85.051129 and 85.051129 or (p_pin->>'longitude')::double precision not between -180 and 180 then raise exception 'VALIDATION_ERROR';end if;
 update public.houses set latitude=(p_pin->>'latitude')::double precision,longitude=(p_pin->>'longitude')::double precision,pin_confirmed_by=u.id,pin_confirmed_at=now() where id=hid;
 end if;end if;
 return (select case when latitude is not null and pin_confirmed_at is not null then jsonb_build_object('latitude',latitude,'longitude',longitude) end from public.houses where id=hid);
end$$;
create or replace function public.bloom_day_pins(p_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 return (select coalesce(jsonb_agg(jsonb_build_object('jobId',dto->>'id','latitude',coalesce(h.latitude,p.latitude),'longitude',coalesce(h.longitude,p.longitude))),'[]')
 from jsonb_array_elements(public.bloom_jobs(p_date,p_date)) dto join public.jobs j on j.id=(dto->>'id')::uuid
 left join public.houses h on h.id=j.house_id and h.pin_confirmed_at is not null
 left join private.property_pins p on p.property_id=j.property_id and j.house_id is null
 where coalesce(h.latitude,p.latitude) is not null);
end$$;
create function public.bloom_property_room_visits(p_property uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 perform private.require_actor();if not private.people_access(p_property,(private.actor()).id) then raise exception 'NOT_FOUND';end if;
 return (select coalesce(jsonb_agg(private.job_dto(j.id) order by j.checkout_date desc),'[]') from public.jobs j where private.visit_access(j.id,true) and j.house_id=(select house_id from public.properties where id=p_property) and j.checkout_date>=(now() at time zone j.timezone_snapshot)::date-90);
end$$;
revoke all on function public.bloom_property_room_visits(uuid) from public,anon;
grant execute on function public.bloom_property_room_visits(uuid) to authenticated;
alter function public.bloom_calendar_add(jsonb,text) rename to bloom_calendar_add_before_visits;
create function public.bloom_calendar_add(p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$declare hid uuid;begin
 select house_id into hid from public.properties where id=(p_input->>'propertyId')::uuid;
 if hid is not null then
 perform pg_advisory_xact_lock(hashtextextended('house-visit:'||hid,0));
 if p_input->>'action'='move' then raise exception 'REVIEW_REQUIRED';end if;
 if jsonb_array_length(coalesce(p_input->'cleaners','[]'))>0 and exists(select 1 from public.jobs where house_id=hid and checkout_date=(p_input->>'date')::date) then raise exception 'REVIEW_REQUIRED';end if;
 end if;
 return public.bloom_calendar_add_before_visits(p_input,p_key);
end$$;
alter function private.calendar_add_cleaning(public.jobs) rename to calendar_add_cleaning_before_visits;
create function private.calendar_add_cleaning(j public.jobs) returns jsonb language sql stable security definer set search_path='' as $$
 select private.calendar_add_cleaning_before_visits(j)||case when j.house_id is null then '{}'::jsonb else jsonb_build_object('propertyName',private.job_dto(j.id)->>'propertyName','eligibleToMove',false,'eligibleForCheckout',false) end
$$;
revoke all on function public.bloom_calendar_add_before_visits(jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.bloom_calendar_add(jsonb,text) from public,anon,service_role;
grant execute on function public.bloom_calendar_add(jsonb,text) to authenticated;
do $$declare def text;begin
 def:=pg_get_functiondef('public.bloom_house_items(uuid,uuid,text,text,integer,uuid,text)'::regprocedure);
 def:=replace(def,$old$and j.status='open' and private.assigned(j.id)$old$,$new$and j.status in ('open','completed') and private.assigned(j.id)$new$);
 def:=replace(def,'select * into i from public.house_items', 'if not manager and not exists(select 1 from public.jobs where id=p_job and status=''open'' and started_at is not null and not review_required) then raise exception ''INVALID_STATE'';end if; select * into i from public.house_items');
 def:=replace(def,'elsif p_action=''report'' then','elsif p_action=''report'' then if p_job is not null and exists(select 1 from public.house_item_reports rep where rep.item_id=i.id and rep.job_id=p_job and rep.revision=i.revision and rep.value=p_value) then return private.save_receipt(''house_item'',p_key,v_input,jsonb_build_object(''id'',i.id,''revision'',i.revision));end if;');
 execute def;
end$$;

revoke all on function private.job_dto(uuid),private.calendar_add_cleaning(public.jobs),private.manual_create_job(uuid,date,jsonb,text,uuid) from public,anon,authenticated,service_role;
create function private.visit_private_member_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.ended_at is null and exists(select 1 from public.jobs j join private.room_turnovers t on t.job_id=j.id where j.id=new.job_id and j.cleaning_management='private' and t.included and not private.team_member(t.property_id,new.cleaner_id)) then raise exception 'FORBIDDEN';end if;return new;
end$$;
create trigger visit_private_member_guard before insert or update on public.assignments for each row execute function private.visit_private_member_guard();
-- New private helpers have no callable client surface.
do $$declare r record;begin
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and (p.proname='complete_room_visit' or p.proname like 'visit_%' or p.proname like 'room_%' or p.proname like '%before%visits%') loop execute 'revoke all on function '||r.signature||' from public,anon,authenticated,service_role';end loop;
end$$;
revoke all on function public.bloom_job_action_before_room_visits(uuid,text,text,integer,jsonb),public.bloom_property_calendar_before_visits(uuid,text,jsonb,text),public.bloom_calendar_finish_before_visits(uuid,uuid,uuid,bigint,jsonb,jsonb),public.bloom_property_pin_before_visits(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.bloom_room_visit(uuid),public.bloom_room_visit_action(uuid,text,jsonb,integer,text),public.bloom_job_action(uuid,text,text,integer,jsonb),public.bloom_property_calendar_action(uuid,text,jsonb,text),public.bloom_property_pin(uuid,jsonb),public.bloom_calendar_finish_sync(uuid,uuid,uuid,bigint,jsonb,jsonb) from public,anon;
grant execute on function public.bloom_room_visit(uuid),public.bloom_room_visit_action(uuid,text,jsonb,integer,text),public.bloom_job_action(uuid,text,text,integer,jsonb),public.bloom_property_calendar_action(uuid,text,jsonb,text),public.bloom_property_pin(uuid,jsonb) to authenticated;
revoke all on function public.bloom_calendar_finish_sync(uuid,uuid,uuid,bigint,jsonb,jsonb) from authenticated;
grant execute on function public.bloom_calendar_finish_sync(uuid,uuid,uuid,bigint,jsonb,jsonb) to service_role;
-- Release only operationally configured rooms. Calendars and coordinates are optional.
do $$declare def text;begin
 def:=pg_get_functiondef('public.bloom_listing_drafts(uuid,text,jsonb,integer,text)'::regprocedure);
 def:=replace(def,'if p.listing_type=''room'' then raise exception ''REVIEW_REQUIRED'';end if;',
 $gate$if p.listing_type='room' and (p.room_identifier is null
 or not exists(select 1 from public.house_visit_pricing where house_id=p.house_id)
 or not exists(select 1 from public.house_spaces where house_id=p.house_id and property_id=p.id and kind='bedroom')
 or (select count(distinct kind) from public.house_spaces where house_id=p.house_id and property_id is null and kind in ('bathroom','kitchen','living_room'))<>3
 or not exists(select 1 from public.property_entry_instructions where property_id=p.id and (length(trim(coalesce(access_info->>'code','')))>0 or length(trim(coalesce(access_info->>'entryNotes','')))>0))) then raise exception 'REVIEW_REQUIRED';end if;$gate$);
 execute def;
end$$;

create table private.house_pricing_history(id uuid primary key default gen_random_uuid(),house_id uuid references public.houses,actor_id uuid references public.users,before_snapshot jsonb not null,after_snapshot jsonb not null,created_at timestamptz not null default now());
revoke all on private.house_pricing_history from public,anon,authenticated,service_role;
create trigger house_pricing_history_immutable before update or delete on private.house_pricing_history for each row execute function private.immutable();
create function public.bloom_house_pricing(p_property uuid,p_rules jsonb default null,p_revision integer default null,p_key text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;v public.house_visit_pricing;old_value jsonb;r jsonb;input jsonb:=jsonb_build_object('property',p_property,'rules',p_rules,'revision',p_revision);begin
 u:=private.require_actor();if u.role not in ('owner','admin') or not private.people_access(p_property,u.id) then raise exception 'NOT_FOUND';end if;
 select v0.* into v from public.house_visit_pricing v0 join public.properties p on p.house_id=v0.house_id where p.id=p_property for update of v0;
 if v.house_id is null then raise exception 'NOT_FOUND';end if;
 if p_rules is not null then
 r:=private.receipt('house_pricing',p_key,input);if r is not null then return r;end if;
 if p_revision is distinct from v.revision then raise exception 'CONFLICT';end if;
 if jsonb_typeof(p_rules) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_rules))<>4 or exists(select 1 from jsonb_each(p_rules) e where e.key not in ('firstHostCents','additionalHostCents','firstPoolCents','additionalPoolCents') or jsonb_typeof(e.value) is distinct from 'number') then raise exception 'VALIDATION_ERROR';end if;
 if (p_rules->>'firstHostCents')::integer not between 0 and 100000000 or (p_rules->>'additionalHostCents')::integer not between 0 and 100000000 or (p_rules->>'firstPoolCents')::integer not between 2 and 100000000 or (p_rules->>'additionalPoolCents')::integer not between 0 and 100000000 or (p_rules->>'firstPoolCents')::integer%2<>0 or (p_rules->>'additionalPoolCents')::integer%2<>0 then raise exception 'VALIDATION_ERROR';end if;
 old_value:=to_jsonb(v);
 update public.house_visit_pricing set first_host_cents=(p_rules->>'firstHostCents')::integer,additional_host_cents=(p_rules->>'additionalHostCents')::integer,first_pool_cents=(p_rules->>'firstPoolCents')::integer,additional_pool_cents=(p_rules->>'additionalPoolCents')::integer,revision=revision+1 where house_id=v.house_id returning * into v;
 insert into private.house_pricing_history(house_id,actor_id,before_snapshot,after_snapshot) values(v.house_id,u.id,old_value,to_jsonb(v));
 end if;
 r:=jsonb_build_object('firstHostCents',v.first_host_cents,'additionalHostCents',v.additional_host_cents,'firstPoolCents',v.first_pool_cents,'additionalPoolCents',v.additional_pool_cents,'revision',v.revision);
 if p_rules is not null then return private.save_receipt('house_pricing',p_key,input,r);end if;return r;
end$$;
revoke all on function public.bloom_house_pricing(uuid,jsonb,integer,text) from public,anon;
grant execute on function public.bloom_house_pricing(uuid,jsonb,integer,text) to authenticated;

do $$declare def text;branch text;begin
 def:=pg_get_functiondef('public.bloom_house_items(uuid,uuid,text,text,integer,uuid,text)'::regprocedure);
 branch:=$branch$
 if p_action in ('add_room_supply','add_shared_supply','add_room_maintenance','add_shared_maintenance') then
 if not manager then raise exception 'FORBIDDEN';end if;
 if p_value is null or length(trim(p_value)) not between 1 and 200 then raise exception 'VALIDATION_ERROR';end if;
 r:=private.receipt('house_item',p_key,v_input);if r is not null then return r;end if;
 insert into public.house_items(house_id,property_id,kind,category,name,proposed)
 values(p.house_id,case when split_part(p_action,'_',2)='room' then p.id end,split_part(p_action,'_',3),case when split_part(p_action,'_',2)='room' then 'Room' else 'Shared' end,trim(p_value),false)
 on conflict(house_id,property_id,kind,category,name) do update set active=true,proposed=false,revision=public.house_items.revision+1 where not public.house_items.active returning * into i;
 if i.id is null then raise exception 'CONFLICT';end if;
 return private.save_receipt('house_item',p_key,v_input,jsonb_build_object('id',i.id,'revision',i.revision));
 end if;
 select * into i from public.house_items
 $branch$;
 execute replace(def,'select * into i from public.house_items',branch);
end$$;

alter table public.house_spaces add column revision integer not null default 0;
create function public.bloom_room_spaces(p_property uuid,p_spaces jsonb default null,p_key text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users;p public.properties;sp public.house_spaces;x jsonb;r jsonb;input jsonb:=jsonb_build_object('property',p_property,'spaces',p_spaces);begin
 u:=private.require_actor();select * into p from public.properties where id=p_property;
 if p.listing_type<>'room' or not private.people_access(p.id,u.id) then raise exception 'NOT_FOUND';end if;
 if p_spaces is not null then
 perform 1 from public.houses where id=p.house_id for update;
 r:=private.receipt('room_spaces',p_key,input);if r is not null then return r;end if;
 if jsonb_typeof(p_spaces) is distinct from 'array' or jsonb_array_length(p_spaces)>100 then raise exception 'VALIDATION_ERROR';end if;
 for x in select value from jsonb_array_elements(p_spaces) loop
 select * into sp from public.house_spaces where id=(x->>'id')::uuid and house_id=p.house_id and (property_id is null or property_id=p.id) for update;
 if sp.id is null or jsonb_typeof(x->'label') is distinct from 'string' or length(trim(x->>'label')) not between 1 and 100 then raise exception 'VALIDATION_ERROR';end if;
 if (x->>'revision')::integer is distinct from sp.revision then raise exception 'CONFLICT';end if;
 update public.house_spaces set label=trim(x->>'label'),revision=revision+1 where id=sp.id and label is distinct from trim(x->>'label');
 end loop;
 update public.properties set cleaning_config=jsonb_build_object('version',coalesce((cleaning_config->>'version')::integer,0)+1,'supplies','[]'::jsonb,'rooms',(select jsonb_agg(jsonb_build_object('id',id,'label',label,'type',case kind when 'bedroom' then 'bedrooms' when 'bathroom' then 'bathrooms' else kind end,'requiredPhoto',true) order by property_id nulls last,kind,id) from public.house_spaces where house_id=p.house_id and (property_id is null or property_id=p.id) and kind in ('bedroom','bathroom','kitchen','living_room'))),bedroom_count=1,bathroom_count=(select count(*) from public.house_spaces where house_id=p.house_id and kind='bathroom' and (property_id is null or property_id=p.id)) where id=p.id;
 end if;
 r:=(select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'kind',kind,'scope',case when property_id is null then 'shared' else 'room' end,'revision',revision) order by property_id nulls last,kind,id),'[]') from public.house_spaces where house_id=p.house_id and (property_id is null or property_id=p.id));
 if p_spaces is not null then return private.save_receipt('room_spaces',p_key,input,r);end if;return r;
end$$;
revoke all on function public.bloom_room_spaces(uuid,jsonb,text) from public,anon;
grant execute on function public.bloom_room_spaces(uuid,jsonb,text) to authenticated;

do $$declare def text;begin
 def:=pg_get_functiondef('public.bloom_listing_draft_create(uuid,text,jsonb,text,uuid)'::regprocedure);
 execute replace(def,'if u.role=''owner'' then insert into public.property_owners(property_id,owner_id) values(pid,u.id);end if;', 'if u.role=''owner'' then insert into public.property_owners(property_id,owner_id) values(pid,u.id);update public.properties set cleaning_management=''private'',bloom_approved=false,private_payer_id=u.id where id=pid;end if;');
end$$;

alter function public.bloom_admin_set_pricing(uuid,integer,text,boolean,integer,text) rename to bloom_admin_set_pricing_before_visits;
create function public.bloom_admin_set_pricing(p_id uuid,p_cents integer,p_key text,p_job boolean default false,p_version integer default null,p_reason text default null) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.require_actor('admin');
 if (p_job and exists(select 1 from public.jobs where id=p_id and house_id is not null)) or (not p_job and exists(select 1 from public.properties where id=p_id and listing_type='room')) then raise exception 'REVIEW_REQUIRED';end if;
 return public.bloom_admin_set_pricing_before_visits(p_id,p_cents,p_key,p_job,p_version,p_reason);
end$$;
revoke all on function public.bloom_admin_set_pricing_before_visits(uuid,integer,text,boolean,integer,text) from public,anon,authenticated,service_role;
revoke all on function public.bloom_admin_set_pricing(uuid,integer,text,boolean,integer,text) from public,anon;
grant execute on function public.bloom_admin_set_pricing(uuid,integer,text,boolean,integer,text) to authenticated;

do $$declare def text;begin
 def:=pg_get_functiondef('public.bloom_listing_drafts(uuid,text,jsonb,integer,text)'::regprocedure);
 execute replace(def,$old$'revision',x.draft_revision)$old$,$new$'revision',x.draft_revision,'canConfirmPin',u.role='admin')$new$);
end$$;

do $$declare def text;begin
 def:=pg_get_functiondef('public.bloom_house_items(uuid,uuid,text,text,integer,uuid,text)'::regprocedure);
 execute replace(def,$old$(i.kind='maintenance' and p_value not in ('good','issue'))$old$,$new$(i.kind='maintenance' and p_value not in ('good','issue','not_applicable'))$new$);
end$$;

do $$declare def text;begin
 def:=pg_get_functiondef('public.bloom_house_items(uuid,uuid,text,text,integer,uuid,text)'::regprocedure);
 execute replace(def,$old$if p_action='list' then$old$,$new$
 if p_job is not null and not exists(select 1 from public.jobs scoped join private.room_turnovers rt on rt.job_id=scoped.id where scoped.id=p_job and scoped.house_id=p.house_id and rt.property_id=p.id and rt.included) then raise exception 'NOT_FOUND';end if;
 if p_job is not null and p_action='report' and exists(select 1 from public.jobs where id=p_job and status<>'open') then raise exception 'INVALID_STATE';end if;
 if p_action='list' then$new$);
end$$;

commit;
