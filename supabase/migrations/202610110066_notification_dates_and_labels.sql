begin;
-- Keep delivery eligibility, account routing and reminder scheduling unchanged.
do $migration$
declare definition text;old_line text;
begin
 definition:=pg_get_functiondef('private.push_content_before_handoff(uuid,timestamptz)'::regprocedure);
 if position('Mon FMDD' in definition)=0 then raise exception 'New-job date formatter changed';end if;
 execute replace(definition,'''Mon FMDD''','''Mon FMDD, YYYY''');
 definition:=pg_get_functiondef('public.bloom_push_delivery(uuid,uuid,text)'::regprocedure);
 old_line:=$line$content:=jsonb_set(content,'{body}',to_jsonb('['||(select initcap(role::text) from public.users where id=x.user_id)||'] '||(content->>'body')));$line$;
 if position(old_line in definition)=0 then raise exception 'Push role formatter changed';end if;
 execute replace(definition,old_line,'-- Message wording identifies the event; account routing stays in delivery metadata.');
end $migration$;
commit;
