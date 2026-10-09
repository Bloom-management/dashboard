begin;
do $migration$
declare definition text;begin
 definition:=pg_get_functiondef('private.complete_cleaning(uuid,jsonb,text)'::regprocedure);
 if position('^[1-5]$' in definition)=0 then raise exception 'Review validation changed';end if;
 definition:=replace(definition,'^[1-5]$','^([1-4](\.5)?|5)$');
 execute definition;
end $migration$;
commit;
