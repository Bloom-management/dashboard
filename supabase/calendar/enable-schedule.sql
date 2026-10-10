-- Apply after the production calendar endpoint is deployed and verified.
-- Vault values: bloom_calendar_url, bloom_calendar_scheduler_secret.
-- The latter must match Vercel CALENDAR_SYNC_SECRET. Never commit secret values.
begin;
do $$ begin
 if (select count(*) from vault.decrypted_secrets where name in ('bloom_calendar_url','bloom_calendar_scheduler_secret'))<>2 then raise exception 'Configure calendar Vault secrets first';end if;
 if (select decrypted_secret from vault.decrypted_secrets where name='bloom_calendar_url')<>'https://admin.bloomcleaning.org/api/admin/calendar/scheduled-sync' then raise exception 'Unexpected calendar endpoint';end if;
 if (select length(decrypted_secret) from vault.decrypted_secrets where name='bloom_calendar_scheduler_secret')<32 then raise exception 'Invalid calendar scheduler secret';end if;
end $$;
select cron.schedule('bloom-calendar-sync','*/5 * * * *',$job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='bloom_calendar_url'),
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='bloom_calendar_scheduler_secret'),'Idempotency-Key','calendar-cron-'||gen_random_uuid()::text),
  body:='{}'::jsonb,timeout_milliseconds:=55000
 );
$job$);
commit;
-- Stop with select cron.unschedule('bloom-calendar-sync');
-- Existing source leases prevent concurrent reconciliation; each run uses a fresh key.
