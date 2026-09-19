"""Disposable database checks; simulated claims, not real Clerk/Storage HTTP."""
import concurrent.futures
import json
import unittest
from test_database import sql, scalar, make_user, make_job, action, configure_completion_fixture

class AdminParticipationTests(unittest.TestCase):
    def test_admin_any_city_capacity_replay_and_withdrawal(self):
        admin,uid=make_user('admin');cleaner,_=make_user();owner,_=make_user('owner')
        city=scalar("insert into public.cities(name) values('Admin test-'||gen_random_uuid()) returning id;")
        job,_=make_job(city=city)
        before=scalar(f"select row(role,approved_city_id)::text from public.users where id='{uid}';")
        self.assertIn('CITY_MISMATCH',action(cleaner,job,'claim').stderr)
        self.assertIn('FORBIDDEN',action(owner,job,'claim').stderr)
        first=action(admin,job,'claim','admin-claim');self.assertEqual(first.returncode,0,first.stderr)
        self.assertEqual(action(admin,job,'claim','admin-claim').stdout,first.stdout)
        self.assertIn('ALREADY_ASSIGNED',action(admin,job,'claim').stderr)
        contenders=[make_user('admin')[0],make_user('admin')[0]]
        with concurrent.futures.ThreadPoolExecutor() as pool:
            results=list(pool.map(lambda u:action(u,job,'claim'),contenders))
        self.assertEqual(sum(r.returncode==0 for r in results),1)
        self.assertTrue(any('JOB_FULL' in r.stderr for r in results))
        self.assertEqual(action(admin,job,'withdraw').returncode,0)
        self.assertEqual(scalar(f"select row(role,approved_city_id)::text from public.users where id='{uid}';"),before)
        self.assertEqual(scalar(f"select count(*) from public.assignments where job_id='{job}' and ended_at is null;"),'1')
    def test_admin_upload_finalize_complete_preserves_rules(self):
        admin,uid=make_user('admin');other,_=make_user('admin');cleaner,cid=make_user()
        job,_=make_job(day="(clock_timestamp() at time zone 'America/Detroit')::date-1")
        sql(f"insert into public.assignments(job_id,cleaner_id,slot) values('{job}','{uid}',1),('{job}','{cid}',2);")
        self.assertIn('WITHDRAWAL_DEADLINE',action(admin,job,'withdraw').stderr)
        self.assertIn('NOT_FOUND',action(other,job,'complete').stderr)
        configure_completion_fixture(job)
        for category in ['bedrooms','bathrooms','kitchen','living_room']:
            self.assertIn('PHOTO_COVERAGE_REQUIRED',action(admin,job,'complete').stderr)
            room=scalar(f"select r->>'id' from public.jobs j,jsonb_array_elements(j.cleaning_config->'rooms') r where j.id='{job}' and r->>'type'='{category}';")
            ticket=json.loads(scalar(f"select public.bloom_room_photo_prepare('{job}','{room}','image/png',100,'{category}');",admin))
            self.assertNotEqual(sql(f"insert into storage.objects(bucket_id,name) values('job-photos','{ticket['path']}');",other,ok=False).returncode,0)
            sql(f"insert into storage.objects(bucket_id,name) values('job-photos','{ticket['path']}');",admin)
            result=sql(f"select public.bloom_photo_finalize_verified('{admin}','{job}','{ticket['photoId']}',100,'image/png','{category}');",'server','service_role')
            self.assertEqual(result.returncode,0)
        result=action(admin,job,'complete','finish');self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(action(admin,job,'complete','finish').stdout,result.stdout)
        self.assertEqual(scalar(f"select string_agg(completed_pay_cents::text,',' order by slot) from public.assignments where job_id='{job}';"),'3750,3750')
        self.assertEqual(scalar(f"select completed_by::text from public.jobs where id='{job}';"),uid)
        self.assertIn('INVALID_STATE',sql(f"update public.assignments set completed_pay_cents=1 where job_id='{job}';",ok=False).stderr)
    def test_admin_review_and_start_guards(self):
        admin,_=make_user('admin');job,_=make_job(review=True)
        self.assertIn('REVIEW_REQUIRED',action(admin,job,'claim').stderr)
        future,_=make_job();self.assertEqual(action(admin,future,'claim').returncode,0)
        self.assertIn('INVALID_STATE',action(admin,future,'complete').stderr)

if __name__=='__main__':unittest.main(verbosity=2)
