-- Release step: enable background delivery after deploying the push endpoints.
-- Separate from schema migrations so local/test database setup never enables sends.
-- First create Vault secrets bloom_push_url (https://YOUR_HOST/api/push/tick)
-- and bloom_push_scheduler_secret (same as server BLOOM_PUSH_SCHEDULER_SECRET).
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$ begin
 if (select count(*) from vault.decrypted_secrets where name in ('bloom_push_url','bloom_push_scheduler_secret'))<>2 then raise exception 'Configure the two Vault secrets first';end if;
 if (select decrypted_secret from vault.decrypted_secrets where name='bloom_push_url') <> 'https://admin.bloomcleaning.org/api/push/tick' then raise exception 'Unexpected production push URL';end if;
 if (select length(decrypted_secret) from vault.decrypted_secrets where name='bloom_push_scheduler_secret')<32 then raise exception 'Scheduler secret must be at least 32 characters';end if;
end $$;
-- Named cron.schedule updates this job on repeat execution; it does not duplicate it.
select public.bloom_push_activate();
select cron.schedule('bloom-push-delivery','* * * * *',$job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='bloom_push_url'),
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='bloom_push_scheduler_secret')),
  body:='{}'::jsonb,timeout_milliseconds:=55000
 );
$job$);
-- Pause with SELECT cron.unschedule('bloom-push-delivery'); AND BLOOM_PUSH_MODE=off.
