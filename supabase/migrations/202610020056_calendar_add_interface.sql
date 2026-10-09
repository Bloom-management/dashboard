begin;
-- Typed shared Owner/Admin UI adapters over the canonical manual calendar service.
create function private.calendar_add_access(p_property uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.properties p cross join lateral private.actor() u where p.id=p_property and p.deleted_at is null and (u.role='admin' or (u.role='owner' and exists(select 1 from public.property_owners po where po.property_id=p.id and po.owner_id=u.id))))
$$;
create function public.bloom_calendar_add_options() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u public.users;begin
 u:=private.require_actor();if u.role not in ('owner','admin') then raise exception 'FORBIDDEN';end if;
 return jsonb_build_object('properties',coalesce((select jsonb_agg(jsonb_build_object(
 'id',p.id,'name',p.name,'timezone',p.timezone,'defaultStartTime',to_char(p.cleaning_start_time,'HH24:MI'),'defaultEndTime',to_char(p.cleaning_end_time,'HH24:MI'),
 'management',p.cleaning_management,'bloomApproved',p.bloom_approved,'bloomAvailable',c.active,'bloomRequestStatus',p.bloom_request_status,
 'payerName',case when p.cleaning_management='bloom' then 'Bloom' else coalesce(payer.display_name,'Property owner') end,'privatePayerName',payer.display_name,
 'canEditPrivateCompensation',not p.is_bloom_owned and payer.id is not null,'canAssignBloom',u.role='admin','bloomCleaners',case when u.role='admin' then coalesce((select jsonb_agg(jsonb_build_object('id',cu.id,'name',cu.display_name) order by cu.display_name,cu.id) from public.users cu where cu.role='cleaner' and cu.approved_city_id=p.city_id and cu.bloom_network_enabled and cu.bloom_pool_approved and cu.onboarding_completed_at is not null),'[]'::jsonb) else '[]'::jsonb end,
 'capacity',p.private_capacity,'totalCents',p.private_total_cents,'soloRateCents',p.solo_rate_cents,'sharedRateCents',p.solo_rate_cents/2,
 'teamMembers',coalesce((select jsonb_agg(jsonb_build_object('id',m.cleaner_id,'name',cu.display_name,'defaultAssigned',m.default_assigned,'individualAmountCents',m.individual_amount_cents) order by cu.display_name,m.cleaner_id) from private.property_cleaner_members m join public.users cu on cu.id=m.cleaner_id where m.property_id=p.id and m.active and cu.role='cleaner' and cu.onboarding_completed_at is not null),'[]'::jsonb)
 ) order by p.name,p.id) from public.properties p join public.cities c on c.id=p.city_id
 left join public.users payer on payer.id=coalesce(p.private_payer_id,(select owner_id from public.property_owners where property_id=p.id order by owner_id limit 1))
 where private.calendar_add_access(p.id) and p.active),'[]'::jsonb));
end$$;
create function private.calendar_add_cleaning(j public.jobs) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',j.id,'propertyId',j.property_id,'propertyName',p.name,'timezone',j.timezone_snapshot,'date',j.checkout_date,
 'startTime',to_char(j.start_at at time zone j.timezone_snapshot,'HH24:MI'),'endTime',to_char(j.end_at at time zone j.timezone_snapshot,'HH24:MI'),
 'management',j.cleaning_management,'status',j.status,'version',j.version,
 'eligibleToMove',j.status='open' and not j.review_required and not j.setup_required and j.started_at is null and j.start_at>now(),
 'eligibleForCheckout',j.status='open' and not j.review_required and not j.setup_required and j.started_at is null and j.manual_booking_id is null and not exists(select 1 from public.job_events where job_id=j.id),
 'assignedCleaners',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.display_name) order by a.slot) from public.assignments a join public.users u on u.id=a.cleaner_id where a.job_id=j.id and a.ended_at is null),'[]'::jsonb)) from public.properties p where p.id=j.property_id
$$;
create function public.bloom_calendar_add_cleanings(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u public.users;begin
 u:=private.require_actor();if u.role not in ('owner','admin') then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to-p_from not between 0 and 2192 then raise exception 'VALIDATION_ERROR';end if;
 return coalesce((select jsonb_agg(private.calendar_add_cleaning(j) order by j.checkout_date,j.id) from public.jobs j where private.calendar_add_access(j.property_id) and j.checkout_date between p_from and p_to and j.status<>'cancelled'),'[]'::jsonb);
end$$;
create function private.calendar_add_stays(p_property uuid) returns table(id uuid,start_date date,end_date date,label text) language sql stable security definer set search_path='' as $$
 select e.id,e.start_local_date,e.end_local_date,case s.provider when 'airbnb' then 'Airbnb' when 'vrbo' then 'Vrbo' else 'Calendar stay' end
 from public.calendar_events e join public.calendar_sources s on s.id=e.source_id where s.property_id=p_property and (e.source_status='active' or e.missing_reason is not null)
 union all select b.id,b.check_in,b.checkout,'Direct booking' from private.manual_bookings b where b.property_id=p_property and b.status='active'
$$;
create function public.bloom_calendar_add_availability(p_property uuid,p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.properties;begin
 perform private.require_actor();if not private.calendar_add_access(p_property) then raise exception 'NOT_FOUND';end if;
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to-p_from not between 0 and 2192 then raise exception 'VALIDATION_ERROR';end if;
 select * into p from public.properties where id=p_property;
 return jsonb_build_object('propertyId',p.id,'timezone',p.timezone,'from',p_from,'to',p_to,'checkoutResolutions',jsonb_build_array('create','reuse','additional'),
 'stays',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'startDate',s.start_date,'endDate',s.end_date,'label',s.label) order by s.start_date,s.id) from private.calendar_add_stays(p.id) s where s.start_date<=p_to and s.end_date>=p_from),'[]'::jsonb),
 'cleanings',coalesce((select jsonb_agg(private.calendar_add_cleaning(j) order by j.checkout_date,j.id) from public.jobs j where j.property_id=p.id and j.status<>'cancelled' and j.checkout_date between p_from and p_to),'[]'::jsonb));
end$$;
create function private.calendar_add_conflict(p_code text,p_message text) returns jsonb language sql immutable set search_path='' as $$select jsonb_build_object('status','conflict','code',p_code,'message',p_message)$$;
create function private.calendar_add_data(x jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare d jsonb;begin
 if x->>'kind'='cleaning' then
  d:=jsonb_build_object('date',x->'date','startTime',x->'startTime','endTime',x->'endTime','instructions',x->'comments','bloomManaged',x->>'management'='bloom',
   'acknowledgeInStay',coalesce((x->>'inStayAcknowledged')::boolean,false),'confirmAssignments',coalesce((x->>'assignedImpactAcknowledged')::boolean,false),
   'confirmAdditional',coalesce((x->>'additionalAcknowledged')::boolean,false));
  if x->>'action'='move' then d:=d||jsonb_build_object('jobId',x->'existingCleaningId','jobVersion',x->'expectedVersion','reason','Cleaning moved from the calendar.');
  elsif x->>'management'='private' then d:=d||jsonb_build_object('capacity',x->'capacity','totalCents',x->'totalCents','cleaners',coalesce((select jsonb_agg(jsonb_build_object('cleanerId',c->'id','amountCents',c->'individualAmountCents')) from jsonb_array_elements(x->'cleaners') c),'[]'::jsonb));end if;
 else
  d:=jsonb_build_object('checkIn',x->'checkIn','checkout',x->'checkout','note',x->'note','checkoutCleaning',case x->'checkoutResolution'->>'action' when 'reuse' then 'associate' when 'additional' then 'additional' else 'create' end,
   'confirmAdditional',x->'checkoutResolution'->>'action'='additional','confirmAssociation',x->'checkoutResolution'->>'action'='reuse','confirmAssignments',coalesce((x->>'assignedImpactAcknowledged')::boolean,false));
  if x->'checkoutResolution'->>'action'='reuse' then d:=d||jsonb_build_object('jobId',x->'checkoutResolution'->'cleaningId','jobVersion',x->'checkoutResolution'->'expectedVersion');end if;
 end if;
 return d||jsonb_build_object('reviewToken',x->'reviewToken');
end$$;
create function public.bloom_calendar_add_review(p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.properties;v jsonb;u public.users;begin
 u:=private.require_actor();if u.role not in ('owner','admin') then raise exception 'FORBIDDEN';end if;
 p:=private.manual_property((p_input->>'propertyId')::uuid);
 v:=private.manual_preview(p.id,private.calendar_add_data(p_input));
 return jsonb_build_object('reviewToken',v->'reviewToken');
end$$;
create function public.bloom_calendar_add(p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.properties;u public.users;d jsonb;r jsonb;action text;j public.jobs;cid uuid;slot integer:=0;start_time timestamptz;end_time timestamptz;code text;begin
 u:=private.require_actor();if u.role not in ('owner','admin') then raise exception 'FORBIDDEN';end if;
 p:=private.manual_property((p_input->>'propertyId')::uuid);
 r:=private.receipt('calendar_add_interface',p_key,p_input);if r is not null then return r;end if;
 if p_input->>'reviewToken' is null then raise exception 'VALIDATION_ERROR';end if;
 if p_input->>'kind'='cleaning' then
  action:=case p_input->>'action' when 'create' then 'create_cleaning' when 'move' then 'move_cleaning' end;
  if action is null or p_input->>'management' not in ('bloom','private') then raise exception 'VALIDATION_ERROR';end if;
  if p_input->>'management'='private' and p.is_bloom_owned then return private.calendar_add_conflict('management','Bloom manages cleaning for this property.');end if;
  if jsonb_typeof(p_input->'cleaners') is distinct from 'array' or jsonb_array_length(p_input->'cleaners')>20 or exists(select 1 from jsonb_array_elements(p_input->'cleaners') c group by c->>'id' having count(*)>1) then raise exception 'VALIDATION_ERROR';end if;
  start_time:=((p_input->>'date')::date+(p_input->>'startTime')::time) at time zone p.timezone;
  end_time:=((p_input->>'date')::date+(p_input->>'endTime')::time) at time zone p.timezone;
  if action='move_cleaning' then
   select * into j from public.jobs where id=(p_input->>'existingCleaningId')::uuid and property_id=p.id for update;
   if j.id is null then raise exception 'NOT_FOUND';end if;
   if j.review_required or j.setup_required then return private.calendar_add_conflict('cleaning_changed','This cleaning needs review before it can be moved.');end if;
   if j.cleaning_management is distinct from p_input->>'management' then return private.calendar_add_conflict('management','Moving this cleaning keeps its current manager, payer, team, and compensation.');end if;
  elsif p_input->>'management'='bloom' and jsonb_array_length(p_input->'cleaners')>0 then
   if u.role<>'admin' then raise exception 'FORBIDDEN';end if;
   if not p.bloom_approved or not exists(select 1 from public.cities where id=p.city_id and active) then return private.calendar_add_conflict('management','Bloom must accept this property before assigning Bloom cleaners.');end if;
   if jsonb_array_length(p_input->'cleaners')>2 then raise exception 'VALIDATION_ERROR';end if;
   if exists(select 1 from jsonb_array_elements(p_input->'cleaners') c where not exists(select 1 from public.users cu where cu.id=(c->>'id')::uuid and cu.role='cleaner' and cu.approved_city_id=p.city_id and cu.bloom_network_enabled and cu.bloom_pool_approved and cu.onboarding_completed_at is not null)) then return private.calendar_add_conflict('staffing','A selected cleaner is no longer eligible for this city. Choose another cleaner.');end if;
  end if;
  -- Stable cleaner locks serialize this flow's cross-property staffing requests.
  for cid in select cleaner from (select (c->>'id')::uuid cleaner from jsonb_array_elements(p_input->'cleaners') c where action='create_cleaning' union select cleaner_id from public.assignments where job_id=j.id and ended_at is null) q order by cleaner loop
   perform 1 from public.users where id=cid for update;
   if exists(select 1 from public.assignments a join public.jobs other on other.id=a.job_id where a.cleaner_id=cid and a.ended_at is null and other.id is distinct from j.id and other.status='open' and other.start_at<end_time and other.end_at>start_time) then return private.calendar_add_conflict('staffing','A selected cleaner already has another cleaning during this window. Choose another cleaner or time.');end if;
  end loop;
 else
  if p_input->>'kind' is distinct from 'booking' then raise exception 'VALIDATION_ERROR';end if;action:='create_booking';
  if p_input->'checkoutResolution'->>'action' not in ('create','reuse','additional') then raise exception 'VALIDATION_ERROR';end if;
  if p_input->'checkoutResolution'->>'action'='reuse' and exists(select 1 from public.jobs existing where existing.id=(p_input->'checkoutResolution'->>'cleaningId')::uuid and existing.property_id=p.id and (existing.review_required or existing.setup_required)) then return private.calendar_add_conflict('cleaning_changed','This checkout cleaning needs review before it can be associated.');end if;
 end if;
 d:=private.calendar_add_data(p_input);
 r:=public.bloom_property_calendar_action(p.id,action,d,p_key);
 if r->>'ok'='false' then
  code:=case r->'conflict'->>'code' when 'UNAVAILABLE_NIGHTS' then 'occupied' when 'IN_STAY_ACK_REQUIRED' then 'in_stay' when 'ASSIGNMENTS_REQUIRE_CONFIRMATION' then 'assigned_impact' when 'ASSOCIATION_CONFIRMATION_REQUIRED' then 'assigned_impact' when 'CHECKOUT_CLEANING_EXISTS' then 'existing_cleaning' when 'ADDITIONAL_CONFIRMATION_REQUIRED' then 'existing_cleaning' else 'cleaning_changed' end;
  return private.calendar_add_conflict(code,r->'conflict'->>'message');
 end if;
 if action='create_cleaning' and p_input->>'management'='bloom' then
  select * into j from public.jobs where id=(r->>'jobId')::uuid;
  if j.cleaning_management='bloom' then
   for cid in select (c->>'id')::uuid from jsonb_array_elements(p_input->'cleaners') c loop
    slot:=slot+1;insert into public.assignments(job_id,cleaner_id,slot) values(j.id,cid,slot);
    perform private.team_notice(p.id,j.id,'You have been assigned a Bloom cleaning at '||p.name||'.',cid);
   end loop;
   if slot>0 then perform private.audit(j.id,'manual_bloom_staffing',null,p_key);end if;
  end if;
 elsif action='move_cleaning' then
  update public.assignments set needs_resolution=true where job_id=(r->>'jobId')::uuid and ended_at is null;
 end if;
 select * into j from public.jobs where id=(r->>'jobId')::uuid;
 r:=jsonb_build_object('status',case when action='move_cleaning' then 'moved' when j.bloom_coverage_requested then 'requested' else 'created' end,'cleaningId',j.id,'date',j.checkout_date)||case when r->>'bookingId' is not null then jsonb_build_object('bookingId',r->'bookingId') else '{}'::jsonb end;
 return private.save_receipt('calendar_add_interface',p_key,p_input,r);
end$$;
revoke all on function private.calendar_add_access(uuid),private.calendar_add_cleaning(public.jobs),private.calendar_add_stays(uuid),private.calendar_add_conflict(text,text),private.calendar_add_data(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.bloom_calendar_add_options(),public.bloom_calendar_add_cleanings(date,date),public.bloom_calendar_add_availability(uuid,date,date),public.bloom_calendar_add_review(jsonb),public.bloom_calendar_add(jsonb,text) from public,anon,service_role;
grant execute on function public.bloom_calendar_add_options(),public.bloom_calendar_add_cleanings(date,date),public.bloom_calendar_add_availability(uuid,date,date),public.bloom_calendar_add_review(jsonb),public.bloom_calendar_add(jsonb,text) to authenticated;
commit;
