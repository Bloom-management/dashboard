begin;
-- Supabase Cron calls the app's push tick every minute (Vercel Hobby only allows daily crons).
-- The tick URL and bearer secret live in Supabase Vault, never in migrations. Until both are
-- configured with bloom_push_configure_scheduler, each scheduled run is a no-op.

create or replace function private.push_scheduled_tick() returns void language plpgsql security definer set search_path='' as $$
declare target text;secret text;begin
 select decrypted_secret into target from vault.decrypted_secrets where name='bloom_push_tick_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='bloom_push_scheduler_secret';
 if target is null or secret is null then return;end if;
 perform net.http_get(url:=target,headers:=jsonb_build_object('Authorization','Bearer '||secret),timeout_milliseconds:=55000);
end $$;
revoke all on function private.push_scheduled_tick() from public,anon,authenticated,service_role;

create or replace function public.bloom_push_configure_scheduler(p_url text,p_secret text) returns boolean language plpgsql security definer set search_path='' as $$
declare existing uuid;begin
 if p_url is null or p_url !~ '^https://[^/]+/api/push/tick$' or p_secret is null or length(p_secret)<32 then raise sqlstate 'PT400' using message='VALIDATION_ERROR';end if;
 select id into existing from vault.secrets where name='bloom_push_tick_url';
 if existing is null then perform vault.create_secret(p_url,'bloom_push_tick_url');else perform vault.update_secret(existing,p_url);end if;
 select id into existing from vault.secrets where name='bloom_push_scheduler_secret';
 if existing is null then perform vault.create_secret(p_secret,'bloom_push_scheduler_secret');else perform vault.update_secret(existing,p_secret);end if;
 return true;
end $$;
revoke all on function public.bloom_push_configure_scheduler(text,text) from public,anon,authenticated;
grant execute on function public.bloom_push_configure_scheduler(text,text) to service_role;

-- Re-announce one still-claimable Bloom job as new (for example after an outage). A fresh batch key
-- gives it new logical message keys; the next tick builds messages for currently eligible recipients.
create or replace function public.bloom_push_republish(p_job uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare city uuid;begin
 if not private.push_claimable(p_job,now()) then return false;end if;
 select p.city_id into city from public.jobs j join public.properties p on p.id=j.property_id where j.id=p_job;
 insert into private.push_publications(job_id,batch,city_id,consumed,published_at) values(p_job,'resend:'||p_job||':'||now(),city,false,now())
 on conflict(job_id) do update set batch=excluded.batch,city_id=excluded.city_id,consumed=false,published_at=excluded.published_at;
 return true;
end $$;
revoke all on function public.bloom_push_republish(uuid) from public,anon,authenticated;
grant execute on function public.bloom_push_republish(uuid) to service_role;

do $$begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') and exists(select 1 from pg_available_extensions where name='pg_net')
  and exists(select 1 from pg_namespace where nspname='vault') then
  create extension if not exists pg_net with schema extensions;
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('bloom-push-tick','* * * * *','select private.push_scheduled_tick()');
 end if;
end $$;
commit;
