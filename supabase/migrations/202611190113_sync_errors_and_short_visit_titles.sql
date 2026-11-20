begin;
-- Sync history keeps the database's real refusal reason instead of collapsing it into CONFIGURATION_ERROR.
do $$declare f regprocedure;def text;
 old text:='''CONFIGURATION_ERROR'',''SYNC_FAILED''';
 new text:='''CONFIGURATION_ERROR'',''SYNC_FAILED'',''REVIEW_REQUIRED'',''INVALID_STATE'',''CONFLICT'',''VALIDATION_ERROR'',''NOT_FOUND'',''FORBIDDEN'',''SOURCE_DISABLED''';
begin
 foreach f in array array['public.bloom_calendar_fail_sync(uuid,uuid,uuid,bigint,text)'::regprocedure,'public.bloom_owner_calendar_fail_sync(uuid,uuid,uuid,uuid,bigint,text)'::regprocedure] loop
  def:=pg_get_functiondef(f);
  if position(old in def)=0 then raise exception '% error allowlist not found',f;end if;
  execute replace(def,old,new);
 end loop;
end$$;

-- Visit titles use the street address only: "4903 Lincoln Blvd DH 1 & DH 4".
do $$declare def text;old text:='''propertyName'',h.name||'' · ''||coalesce(';begin
 def:=pg_get_functiondef('private.job_dto_before_check_in(uuid)'::regprocedure);
 if position(old in def)=0 then raise exception 'job title expression not found';end if;
 execute replace(def,old,'''propertyName'',split_part(h.name,'','',1)||'' ''||coalesce(');
 def:=pg_get_functiondef('private.visit_notice(uuid,text,text,uuid)'::regprocedure);
 if position('coalesce(h.name,pr.name)' in def)=0 then raise exception 'notice title expression not found';end if;
 execute replace(def,'coalesce(h.name,pr.name)','coalesce(split_part(h.name,'','',1),pr.name)');
 def:=pg_get_functiondef('private.room_visit_grouped_notice(uuid)'::regprocedure);
 if position('select name into house from public.houses' in def)=0 then raise exception 'grouped notice house name not found';end if;
 execute replace(def,'select name into house from public.houses','select split_part(name,'','',1) into house from public.houses');
end$$;
commit;
