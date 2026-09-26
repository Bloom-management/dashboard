begin;
-- Delayed configuration must respect the job's snapshotted compensation mode,
-- even if the property's defaults were edited while setup was incomplete.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('private.autoassign_private()'::regprocedure);
 if position('values(new.id,m.cleaner_id,s,m.individual_amount_cents)' in definition)=0 then raise exception 'Expected private auto-assignment expression missing';end if;
 definition:=replace(definition,'t.active and t.default_assigned and u.role=','t.active and t.default_assigned and (new.compensation_mode=''equal'' or t.individual_amount_cents is not null) and u.role=');
 definition:=replace(definition,'values(new.id,m.cleaner_id,s,m.individual_amount_cents)','values(new.id,m.cleaner_id,s,case when new.compensation_mode=''individual'' then m.individual_amount_cents else null end)');
 execute definition;
end $$;
create or replace function private.guard_private_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
declare j public.jobs;begin
 select * into j from public.jobs where id=new.job_id for update;
 if new.slot>j.staffing_capacity then raise exception 'JOB_FULL';end if;
 if j.cleaning_management='private' then
  if TG_OP='INSERT' and not private.team_member(j.property_id,new.cleaner_id) then raise exception 'FORBIDDEN';end if;
  if (j.compensation_mode='equal' and new.agreed_pay_cents is not null)
   or (j.compensation_mode='individual' and new.agreed_pay_cents is null and new.ended_at is null)
  then raise exception 'VALIDATION_ERROR';end if;
 end if;
 return new;
end $$;
commit;
