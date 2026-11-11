-- Explicit isolated HTTPS test deployment only. Never part of migration application.
-- psql -v bloom_test_origin=... -f supabase/push/enable-test-schedule.sql
-- Server MUST use test mode with both subject/device allowlists and synthetic data.
\set ON_ERROR_STOP on
\if :{?bloom_test_origin}
\else
  \echo 'Supply bloom_test_origin for the isolated HTTPS deployment.'
  \quit 2
\endif
select set_config('bloom.push_test_origin',:'bloom_test_origin',false) as test_origin \gset
do $$declare origin text:=current_setting('bloom.push_test_origin');begin
 if origin !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$' or origin in ('https://admin.bloomcleaning.org','https://bloomcleaning.org') then raise exception 'Expected an isolated nonproduction HTTPS origin';end if;
 if (select count(*) from vault.decrypted_secrets where name in ('bloom_push_url','bloom_push_scheduler_secret'))<>2 then raise exception 'Configure test Vault secrets first';end if;
 if (select decrypted_secret from vault.decrypted_secrets where name='bloom_push_url') is distinct from origin||'/api/push/tick' then raise exception 'Unexpected test scheduler target';end if;
 if (select length(decrypted_secret) from vault.decrypted_secrets where name='bloom_push_scheduler_secret')<32 then raise exception 'Invalid scheduler secret';end if;
end $$;
create extension if not exists pg_cron;
create extension if not exists pg_net;
select public.bloom_push_activate();
select cron.schedule('bloom-push-delivery','* * * * *',$job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='bloom_push_url'),
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='bloom_push_scheduler_secret')),
  body:='{}'::jsonb,timeout_milliseconds:=55000);
$job$);
