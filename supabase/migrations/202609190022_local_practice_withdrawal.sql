begin;
-- Empty everywhere by default. Only the local runtime fixture script adds exact
-- actor/job pairs; no API, role or user metadata can grant an exception.
create table private.practice_withdrawal_exceptions (
 actor_id uuid not null references public.users,
 job_id uuid not null references public.jobs,
 primary key(actor_id,job_id)
);
revoke all on private.practice_withdrawal_exceptions from public,anon,authenticated,service_role;
create function private.practice_withdrawal(p_job uuid,p_actor uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.practice_withdrawal_exceptions where job_id=p_job and actor_id=p_actor)
$$;
revoke all on function private.practice_withdrawal(uuid,uuid) from public,anon,authenticated,service_role;
-- Patch just the deadline decision; retain every other lifecycle and history rule.
do $$ declare definition text;old_check text:='if not private.withdrawal_allowed(t,j.start_at) then';begin
 definition:=pg_get_functiondef('private.job_action_v1(uuid,text,text,integer,jsonb)'::regprocedure);
 if position(old_check in definition)=0 then raise exception 'Expected withdrawal guard not found';end if;
 execute replace(definition,old_check,'if not private.withdrawal_allowed(t,j.start_at) and not private.practice_withdrawal(j.id,u.id) then');
end $$;
create or replace function private.job_dto(p_job uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select private.job_dto_base(p_job)||jsonb_build_object('changes',private.job_changes(p_job),
 'withdrawalDeadlineExempt',private.practice_withdrawal(p_job,(private.actor()).id))
$$;
commit;
