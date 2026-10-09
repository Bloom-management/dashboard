begin;
-- Keep the existing completion transaction, authorization, immutable receipt and
-- retry behavior. Older clients/receipts without a guest review remain valid.
do $migration$
declare definition text;begin
 definition:=pg_get_functiondef('private.complete_cleaning(uuid,jsonb,text)'::regprocedure);
 if position('''configVersion'',''answers'',''notes'',''maintenance''' in definition)=0 then raise exception 'Completion validation changed; review guest rating migration';end if;
 definition:=replace(definition,'''configVersion'',''answers'',''notes'',''maintenance''','''configVersion'',''answers'',''notes'',''maintenance'',''guestReview''');
 definition:=replace(definition,' if jsonb_typeof(p_payload->''maintenance'')', $validation$
 if p_payload ? 'guestReview' then
  if jsonb_typeof(p_payload->'guestReview') is distinct from 'object' then raise exception 'VALIDATION_ERROR';end if;
  if exists(select 1 from jsonb_object_keys(p_payload->'guestReview') k where k not in ('rating','comment'))
   or jsonb_typeof(p_payload->'guestReview'->'rating') is distinct from 'number'
   or (p_payload->'guestReview'->>'rating') !~ '^[1-5]$'
   or jsonb_typeof(p_payload->'guestReview'->'comment') is distinct from 'string'
   or length(p_payload->'guestReview'->>'comment')>1500 then raise exception 'VALIDATION_ERROR';end if;
 end if;
 if jsonb_typeof(p_payload->'maintenance')$validation$);
 definition:=replace(definition,' insert into public.admin_notification_events(job_id,event_type,payload)', $receipt$
 if p_payload ? 'guestReview' then r:=r||jsonb_build_object('guestReview',p_payload->'guestReview');end if;
 insert into public.admin_notification_events(job_id,event_type,payload)$receipt$);
 execute definition;
end $migration$;
commit;
