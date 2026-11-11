begin;
-- Jobs lock before emitting events; calendar sync locks property then jobs.
-- An outbox FK on property would take KEY SHARE in the reverse order. Keep
-- immutable IDs in the private ledger; every read rechecks live property scope.
alter table private.notification_events drop constraint notification_events_property_id_fkey;
alter table private.report_notification_state drop constraint report_notification_state_property_id_fkey;
-- Claim eligibility still serializes role/city changes, without blocking
-- recipient KEY SHARE checks on non-key user updates in another job action.
do $$declare definition text;begin
 definition:=pg_get_functiondef('private.job_action_v1(uuid,text,text,integer,jsonb)'::regprocedure);
 definition:=replace(definition,'from public.users where id=u.id for update','from public.users where id=u.id for no key update');
 definition:=replace(definition,$needle$where id=(p_payload->>'cleanerId')::uuid for update$needle$,$replacement$where id=(p_payload->>'cleanerId')::uuid for no key update$replacement$);
 execute definition;
end $$;
commit;
