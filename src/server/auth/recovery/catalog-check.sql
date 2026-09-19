-- #1 only: run read-only against the positively identified shared LOCAL database.
-- Catalog evidence is separate from user-token authorization; no account rows are read.
begin read only;
select current_database()='postgres' as expected_database;
with expected(version) as (values
 ('202609120001'),('202609120002'),('202609120003'),('202609120004'),('202609120005'),('202609120006'),
 ('202609130007'),('202609130008'),('202609130009'),('202609140010'),('202609140011'))
select count(*) filter(where m.version is not null)=11 as baseline_eleven_applied,
 coalesce(array_agg(e.version) filter(where m.version is null),'{}') as missing_versions
from expected e left join supabase_migrations.schema_migrations m on m.version=e.version;
select c.relname as application_table,c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('users','properties','property_owners','jobs','assignments','job_photos') order by c.relname;
select has_function_privilege('authenticated','public.bloom_me()','execute') as user_account_rpc,
 has_function_privilege('authenticated','public.bloom_jobs(date,date)','execute') as user_jobs_rpc;
commit;
