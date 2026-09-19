"""Actual PostgreSQL tests with simulated verified JWT claims, never real Clerk verification.
Run via run-local.sh; the harness owns a disposable local cluster.
"""
import concurrent.futures
import json
import os
import subprocess
import unittest
import uuid

HOST = '127.0.0.1'
PORT = os.environ.get('BLOOM_TEST_PORT', '55439')
PSQL = os.environ.get('BLOOM_PSQL', 'psql')
CITY = '00000000-0000-4000-8000-000000000001'

def sql(statement, subject=None, role='authenticated', ok=True):
    prefix = ''
    if subject is not None:
        claims = json.dumps({'sub': subject, 'role': role}).replace("'", "''")
        prefix = f"set role {role};set request.jwt.claims='{claims}';"
    result = subprocess.run([PSQL, '-h', HOST, '-p', PORT, '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=prefix+statement, text=True, capture_output=True)
    if ok and result.returncode:
        raise AssertionError(result.stderr)
    return result

def scalar(statement, subject=None):
    return sql(statement, subject).stdout.strip().splitlines()[-1]

def make_user(role='cleaner', city=CITY):
    subject='test_'+uuid.uuid4().hex
    uid=scalar(f"insert into public.users(clerk_user_id,role,approved_city_id,initial_city_selected_at) values('{subject}','{role}','{city}',now()) returning id;")
    return subject,uid

def make_job(day=None, city=CITY, review=False):
    prop=scalar(f"insert into public.properties(city_id,name,address) values('{city}','Synthetic unit','Development fixture') returning id;")
    day = day or "(clock_timestamp() at time zone 'America/Detroit')::date+3"
    job=scalar(f"insert into public.jobs(property_id,checkout_date,start_at,end_at,timezone_snapshot,solo_rate_cents_snapshot,review_required) select '{prop}',d,(d+time '11:00') at time zone 'America/Detroit',(d+time '15:00') at time zone 'America/Detroit','America/Detroit',7500,{str(review).lower()} from (select {day} as d)x returning id;")
    return job,prop

def maintenance_answers():
    return [dict(category=c,status='ok',notes='') for c in ['painting','fridge','electricity','wifi','tv','garage','climate','water']]

def action(subject,job,kind,key=None,extra=''):
    key=key or uuid.uuid4().hex
    if kind=='complete' and not extra:
        body={'configVersion':1,'answers':[],'notes':'','maintenance':maintenance_answers()}
        extra=",null,'"+json.dumps(body)+"'"
    return sql(f"select public.bloom_job_action('{job}','{kind}','{key}'{extra});",subject,ok=False)

def configure_completion_fixture(job):
    # Explicit synthetic one-bedroom/one-bathroom configuration for legacy tests.
    rooms=[{'id':str(uuid.uuid4()),'type':kind,'label':kind,'requiredPhoto':True} for kind in ['bedrooms','bathrooms','kitchen','living_room']]
    config=json.dumps({'version':1,'rooms':rooms,'supplies':[]})
    sql(f"update public.jobs set cleaning_config='{config}',started_at=start_at where id='{job}';")
    bind_fixture_photos(job)

def bind_fixture_photos(job):
    sql(f"update public.job_photos ph set room_id=(r->>'id')::uuid from public.jobs j,jsonb_array_elements(j.cleaning_config->'rooms') r where ph.job_id=j.id and j.id='{job}' and r->>'type'=ph.category;")

class BackendDatabaseTests(unittest.TestCase):
    def error(self,result,code):
        self.assertNotEqual(result.returncode,0,result.stdout)
        self.assertIn(code,result.stderr)
    def test_rls_enabled_and_anon_denied(self):
        self.assertEqual(scalar("select count(*) from pg_tables t join pg_class c on c.relname=t.tablename join pg_namespace n on n.oid=c.relnamespace and n.nspname=t.schemaname where t.schemaname='public' and not c.relrowsecurity;"),'0')
        self.error(sql('select * from public.users;', 'anonymous', 'anon',False),'permission denied')
        self.error(sql("select public.bloom_onboard('"+CITY+"','x');",'anonymous','anon',False),'permission denied')
    def test_initial_city_no_profile_bypass(self):
        sub='new_'+uuid.uuid4().hex
        first=json.loads(scalar(f"select public.bloom_onboard('{CITY}','first');",sub))
        self.assertEqual(first['role'],'cleaner')
        self.assertEqual(json.loads(scalar(f"select public.bloom_onboard('{CITY}','first');",sub)),first)
        self.error(sql(f"select public.bloom_onboard('{CITY}','second');",sub,ok=False),'INVALID_STATE')
        self.error(sql("update public.users set role='admin';",sub,ok=False),'permission denied')
        self.error(sql("update public.users set approved_city_id=null;",sub,ok=False),'permission denied')
    def test_city_approval_and_wrong_city(self):
        sub,uid=make_user();admin,_=make_user('admin')
        city=scalar("insert into public.cities(name) values('Test-'||gen_random_uuid()) returning id;")
        job,_=make_job(city=city)
        request=json.loads(scalar(f"select public.bloom_city_request('{city}','city');",sub))
        self.error(action(sub,job,'claim'),'CITY_MISMATCH')
        self.error(sql(f"select public.bloom_city_resolve('{request['id']}','approved','resolve');",sub,ok=False),'FORBIDDEN')
        sql(f"select public.bloom_city_resolve('{request['id']}','approved','resolve');",admin)
        self.assertEqual(action(sub,job,'claim').returncode,0)
    def test_three_way_final_slot_and_duplicate(self):
        users=[make_user()[0] for _ in range(3)];job,_=make_job()
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            results=list(pool.map(lambda s:action(s,job,'claim'),users))
        self.assertEqual(sum(r.returncode==0 for r in results),2,[r.stderr for r in results])
        self.assertEqual(sum('JOB_FULL' in r.stderr for r in results),1)
        winner=next(s for s,r in zip(users,results) if r.returncode==0)
        self.error(action(winner,job,'claim'),'ALREADY_ASSIGNED')
        self.assertEqual(scalar(f"select count(*) from public.assignments where job_id='{job}' and ended_at is null;"),'2')
    def test_duplicate_concurrent_key_and_conflict(self):
        sub,_=make_user();job,_=make_job();other,_=make_job()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:action(sub,job,'claim','same'),range(2)))
        self.assertTrue(all(r.returncode==0 for r in results),[r.stderr for r in results])
        self.assertEqual(results[0].stdout,results[1].stdout)
        self.error(action(sub,other,'claim','same'),'CONFLICT')
    def test_multiple_daily_jobs(self):
        sub,_=make_user()
        for _ in range(3):
            job,_=make_job();self.assertEqual(action(sub,job,'claim').returncode,0)
    def test_withdrawal_allowed_and_late(self):
        sub,_=make_user();job,_=make_job()
        self.assertEqual(action(sub,job,'claim').returncode,0)
        self.assertEqual(action(sub,job,'withdraw').returncode,0)
        past,_=make_job(day="(clock_timestamp() at time zone 'America/Detroit')::date-1")
        _,uid=make_user()
        sql(f"insert into public.assignments(job_id,cleaner_id,slot) values('{past}','{uid}',1);")
        subject=scalar(f"select clerk_user_id from public.users where id='{uid}';")
        self.error(action(subject,past,'withdraw'),'WITHDRAWAL_DEADLINE')
    def test_owner_isolation_and_safe_dto(self):
        owner,uid=make_user('owner');other,otherid=make_user('owner');cleaner,_=make_user()
        for ownerid in [uid,otherid]:
            job,prop=make_job()
            sql(f"insert into public.property_owners values('{prop}','{ownerid}');insert into public.calendar_sources(property_id,provider,encrypted_url) values('{prop}','airbnb','synthetic-ciphertext');insert into public.calendar_events(source_id,uid,start_local_date,end_local_date,kind,content_hash) select id,'synthetic-event',current_date,current_date+1,'blocked','hash' from public.calendar_sources where property_id='{prop}';")
        self.assertEqual(scalar('select count(*) from public.property_owners;',owner),'1')
        self.assertEqual(scalar('select count(id) from public.properties;',owner),'1')
        self.assertEqual(scalar('select count(*) from public.assignments;',owner),'0')
        self.error(sql('select solo_rate_cents from public.properties;',owner,ok=False),'permission denied')
        self.error(sql('select * from public.calendar_sources;',owner,ok=False),'permission denied')
        dto=json.loads(scalar('select public.bloom_owner_calendar(current_date,current_date+2);',owner))
        self.assertEqual(len(dto),1)
        self.assertEqual(set(dto[0]),{'id','propertyId','propertyName','timezone','startDate','endDate','providers','kind','removed','changes'})
        self.error(sql('select public.bloom_jobs(current_date,current_date+2);',owner,ok=False),'FORBIDDEN')
        self.error(sql('select public.bloom_owner_calendar(current_date,current_date+2);',cleaner,ok=False),'FORBIDDEN')
    def test_photo_access_and_uploader_spoof(self):
        sub,uid=make_user();outsider,_=make_user();job,_=make_job();other,_=make_job()
        self.assertEqual(action(sub,job,'claim').returncode,0)
        upload=json.loads(scalar(f"select public.bloom_photo_prepare('{job}','kitchen','image/png',100,'photo');",sub))
        path=upload['path']
        self.error(sql(f"insert into storage.objects(bucket_id,name) values('job-photos','{path}');",outsider,ok=False),'row-level security')
        sql(f"insert into storage.objects(bucket_id,name) values('job-photos','{path}');",sub)
        self.assertEqual(scalar("select count(*) from storage.objects;",sub),'0')
        self.error(sql(f"select public.bloom_photo_prepare('{other}','kitchen','image/png',100,'cross');",sub,ok=False),'NOT_FOUND')
        self.error(sql(f"select public.bloom_photo_finalize_verified('{sub}','{job}','{upload['photoId']}',100,'image/png','x');",sub,ok=False),'permission denied')
        self.assertEqual(action(sub,job,'withdraw').returncode,0)
        self.assertEqual(scalar('select count(*) from public.job_photos;',sub),'0')
        self.error(sql(f"select public.bloom_photos('{job}');",sub,ok=False),'NOT_FOUND')
    def test_completion_coverage_idempotence_and_frozen_history(self):
        users=[make_user() for _ in range(2)]
        job,prop=make_job(day="(clock_timestamp() at time zone 'America/Detroit')::date-1")
        for slot,(_,uid) in enumerate(users,1):sql(f"insert into public.assignments(job_id,cleaner_id,slot) values('{job}','{uid}',{slot});")
        configure_completion_fixture(job)
        for cat in ['bedrooms','bathrooms','kitchen','living_room']:
            bind_fixture_photos(job)
            self.error(action(users[0][0],job,'complete'),'PHOTO_COVERAGE_REQUIRED')
            sql(f"insert into public.job_photos(job_id,uploader_id,category,object_path,state,bytes,mime) values('{job}','{users[0][1]}','{cat}','{job}/{cat}','ready',100,'image/png');")
        bind_fixture_photos(job)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda pair:action(pair[0],job,'complete'),users))
        self.assertTrue(all(r.returncode==0 for r in results),[r.stderr for r in results])
        self.assertEqual(scalar(f"select count(*) from public.job_history where job_id='{job}' and action='complete';"),'1')
        self.assertEqual(scalar(f"select string_agg(completed_pay_cents::text,',' order by slot) from public.assignments where job_id='{job}';"),'3750,3750')
        self.error(sql(f"update public.assignments set completed_pay_cents=1 where job_id='{job}';",ok=False),'INVALID_STATE')
        self.error(sql(f"update public.jobs set review_required=true where id='{job}';",ok=False),'INVALID_STATE')
        sql(f"update public.properties set solo_rate_cents=10000 where id='{prop}';")
        self.assertEqual(scalar(f"select solo_rate_cents_snapshot from public.jobs where id='{job}';"),'7500')
        self.assertEqual(action(users[0][0],job,'complete').returncode,0)
        admin,_=make_user('admin')
        self.error(action(admin,job,'cancel',extra=",2,'{\"reason\":\"test\"}'"),'INVALID_STATE')
    def test_review_blocks_claim(self):
        sub,_=make_user();job,_=make_job(review=True)
        self.error(action(sub,job,'claim'),'REVIEW_REQUIRED')
    def test_cleanup_does_not_delete_ready_photos(self):
        sub,uid=make_user();job,_=make_job()
        for state in ['pending','ready']:
            sql(f"insert into public.job_photos(job_id,uploader_id,category,object_path,state,bytes,mime,created_at) values('{job}','{uid}','kitchen','{job}/{state}','{state}',100,'image/png',now()-interval '25 hours');")
        self.error(sql('select public.bloom_expire_pending_photos();',sub,ok=False),'permission denied')
        result=sql('select public.bloom_expire_pending_photos();','server','service_role')
        self.assertIn(f'{job}/pending',result.stdout)
        self.assertEqual(scalar(f"select count(*) from public.job_photos where job_id='{job}' and state='ready';"),'1')
    def test_private_instructions_and_direct_mutation_denial(self):
        sub,_=make_user();other,_=make_user();owner,_=make_user('owner');job,prop=make_job()
        sql(f"insert into public.property_entry_instructions values('{prop}','Synthetic instructions',now());")
        self.assertEqual(action(sub,job,'claim').returncode,0)
        self.assertEqual(scalar('select count(*) from public.property_entry_instructions;',sub),'1')
        for who in [other,owner]:self.assertEqual(scalar('select count(*) from public.property_entry_instructions;',who),'0')
        for table in ['assignments','jobs','job_photos','property_owners','operation_receipts']:
            self.error(sql(f'delete from public.{table};',sub,ok=False),'permission denied')
        self.assertEqual(action(sub,job,'withdraw').returncode,0)
        self.assertEqual(scalar('select count(*) from public.property_entry_instructions;',sub),'0')
    def test_exact_six_hour_boundary(self):
        self.assertEqual(scalar("select private.withdrawal_allowed('2026-09-12 09:00:00+00','2026-09-12 15:00:00+00');"),'t')
        self.assertEqual(scalar("select private.withdrawal_allowed('2026-09-12 08:59:59.999999+00','2026-09-12 15:00:00+00');"),'t')
        self.assertEqual(scalar("select private.withdrawal_allowed('2026-09-12 09:00:00.000001+00','2026-09-12 15:00:00+00');"),'f')
    def test_admin_reassign_after_deadline_and_completed_guard(self):
        admin,_=make_user('admin');old,oldid=make_user();new,newid=make_user()
        job,_=make_job(day="(clock_timestamp() at time zone 'America/Detroit')::date-1")
        assignment=scalar(f"insert into public.assignments(job_id,cleaner_id,slot) values('{job}','{oldid}',1) returning id;")
        self.error(action(old,job,'withdraw'),'WITHDRAWAL_DEADLINE')
        payload=json.dumps({'reason':'Synthetic reassignment','removeAssignmentId':assignment,'cleanerId':newid})
        self.assertEqual(action(admin,job,'reassign',extra=f",1,'{payload}'").returncode,0)
        self.assertEqual(scalar(f"select end_reason from public.assignments where id='{assignment}';"),'reassigned')
        self.assertEqual(scalar(f"select after_snapshot->'context'->>'reason' from public.job_history where job_id='{job}';"),'Synthetic reassignment')
        self.error(action(admin,job,'cancel',extra=",1,'{\"reason\":\"stale\"}'"),'CONFLICT')
    def test_claim_completion_race(self):
        first,firstid=make_user();second,_=make_user()
        zone=scalar("select name from pg_timezone_names where (clock_timestamp() at time zone name)::time between time '11:15' and time '14:45' limit 1;")
        prop=scalar(f"insert into public.properties(city_id,name,address,timezone) values('{CITY}','Race unit','Synthetic','{zone}') returning id;")
        job=scalar(f"insert into public.jobs(property_id,checkout_date,start_at,end_at,timezone_snapshot,solo_rate_cents_snapshot) select '{prop}',d,(d+time '11:00') at time zone '{zone}',(d+time '15:00') at time zone '{zone}','{zone}',7500 from (select (clock_timestamp() at time zone '{zone}')::date d)x returning id;")
        self.assertEqual(action(first,job,'claim').returncode,0)
        for cat in ['bedrooms','bathrooms','kitchen','living_room']:
            sql(f"insert into public.job_photos(job_id,uploader_id,category,object_path,state,bytes,mime) values('{job}','{firstid}','{cat}','{job}/{cat}','ready',100,'image/png');")
        configure_completion_fixture(job)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            claim=pool.submit(action,second,job,'claim');complete=pool.submit(action,first,job,'complete')
            claim_result=claim.result();complete_result=complete.result()
        self.assertEqual(complete_result.returncode,0,complete_result.stderr)
        if claim_result.returncode:self.assertIn('INVALID_STATE',claim_result.stderr)
        self.assertEqual(scalar(f"select sum(completed_pay_cents) from public.assignments where job_id='{job}';"),'7500')
        self.assertEqual(scalar(f"select count(*) from public.assignments where job_id='{job}' and completed_pay_cents is null;"),'0')
    def test_photo_finalize_rechecks_uploader_and_withdrawal(self):
        sub,_=make_user();other,_=make_user();job,_=make_job()
        self.assertEqual(action(sub,job,'claim').returncode,0)
        self.assertEqual(action(other,job,'claim').returncode,0)
        upload=json.loads(scalar(f"select public.bloom_photo_prepare('{job}','kitchen','image/png',100,'upload');",sub))
        def finalize(subject,key='ready'):
            return sql(f"select public.bloom_photo_finalize_verified('{subject}','{job}','{upload['photoId']}',100,'image/png','{key}');",'server','service_role',False)
        self.error(finalize(other),'NOT_FOUND')
        self.assertEqual(finalize(sub).returncode,0)
        self.assertEqual(finalize(sub).returncode,0)
        self.assertEqual(action(sub,job,'withdraw').returncode,0)
        self.error(finalize(sub),'NOT_FOUND')
        self.error(sql(f"select public.bloom_photo_read_receipt('{job}','{upload['photoId']}','read');",sub,ok=False),'NOT_FOUND')
        self.assertEqual(len(json.loads(scalar(f"select public.bloom_photos('{job}');",other))),1)
    def test_timezone_windows_across_dst(self):
        for day,start in [('2026-03-07','16:00:00'),('2026-03-08','15:00:00'),('2026-11-01','16:00:00')]:
            job,_=make_job(day=f"date '{day}'")
            self.assertEqual(scalar(f"select to_char(start_at at time zone 'UTC','HH24:MI:SS') from public.jobs where id='{job}';"),start)

if __name__=='__main__':unittest.main(verbosity=2)
