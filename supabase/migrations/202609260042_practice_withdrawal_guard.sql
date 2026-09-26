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
-- Qualify JSON array rows independently from the PL/pgSQL loop variable x.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.bloom_property_team_action(uuid,text,jsonb,text)'::regprocedure);
 definition:=replace(definition,'jsonb_array_elements(p_data->''cleaners'') x group by x->>''cleanerId''','jsonb_array_elements(p_data->''cleaners'') elem(value) group by elem.value->>''cleanerId''');
 definition:=replace(definition,'jsonb_array_elements(p_data->''cleaners'') x where x->>''individualAmountCents''','jsonb_array_elements(p_data->''cleaners'') elem(value) where elem.value->>''individualAmountCents''');
 execute definition;
end $$;
commit;
