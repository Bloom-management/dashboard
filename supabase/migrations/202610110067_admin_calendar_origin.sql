begin;
-- Include classification evidence in the existing admin-only paginated projection.
-- Preserve the outer manual-return reconciliation wrapper and all authorization.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.bloom_admin_property_calendar_events_before_manual(uuid,uuid)'::regprocedure);
 if position('e.kind,e.source_status' in definition)=0 or position('''kind'',e.kind' in definition)=0 then raise exception 'Admin calendar projection changed';end if;
 definition:=replace(definition,'e.kind,e.source_status','e.kind,e.evidence,e.source_status');
 definition:=replace(definition,'''kind'',e.kind','''kind'',e.kind,''evidence'',e.evidence');
 execute definition;
end$$;
commit;
