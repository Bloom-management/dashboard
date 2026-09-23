-- MANUAL RELEASE STEP ONLY, after review and test-device acceptance.
-- Not a migration: deploying application code must never turn on delivery.
-- First create Vault secrets bloom_push_url (https://YOUR_HOST/api/push/tick)
-- and bloom_push_scheduler_secret (same as server BLOOM_PUSH_SCHEDULER_SECRET).
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$ begin
 if (select count(*) from vault.decrypted_secrets where name in ('bloom_push_url','bloom_push_scheduler_secret'))<>2 then raise exception 'Configure the two Vault secrets first';end if;
end $$;
select public.bloom_push_activate();
select cron.schedule('bloom-push-delivery','* * * * *',$job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='bloom_push_url'),
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='bloom_push_scheduler_secret')),
  body:='{}'::jsonb,timeout_milliseconds:=55000
 );
$job$);
-- Pause with SELECT cron.unschedule('bloom-push-delivery'); AND BLOOM_PUSH_MODE=off.
