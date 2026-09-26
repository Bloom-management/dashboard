begin;
-- Preserve the exact local-only actor/job exemption after the private-team lifecycle extension.
-- The exemption table remains empty in production and has no application write API.
do $$
declare definition text;
 old_check text:='if j.cleaning_management=''bloom'' and not private.withdrawal_allowed(t,j.start_at) then';
begin
 definition:=pg_get_functiondef('private.job_action_v1(uuid,text,text,integer,jsonb)'::regprocedure);
 if position(old_check in definition)=0 then raise exception 'Expected Bloom withdrawal guard not found';end if;
 execute replace(definition,old_check,'if j.cleaning_management=''bloom'' and not private.withdrawal_allowed(t,j.start_at) and not private.practice_withdrawal(j.id,u.id) then');
end $$;
commit;
