-- Run only against the intentionally selected release target. Keeps all history/preferences.
do $$begin
 if to_regclass('cron.job') is not null then
  perform cron.unschedule(jobid) from cron.job where jobname='bloom-push-delivery';
 end if;
end $$;
begin;
select pg_advisory_xact_lock(hashtextextended('bloom-push-tick',0));
update private.push_control set activated_at=null where singleton=true;
commit;
-- Also set BLOOM_PUSH_MODE off, stop manual callers and drain in-flight sends.
