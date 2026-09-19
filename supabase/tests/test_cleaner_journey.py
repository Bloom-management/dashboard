"""Real disposable PostgreSQL transactions. No real jobs, Storage or notification transport."""
import concurrent.futures
import json
import unittest
import uuid
from test_database import sql, scalar, make_user, make_job, action, maintenance_answers

def payload(data):return json.dumps(data).replace("'", "''")
def fixture(supplies=True):
    admin,_=make_user('admin');one,uid=make_user();two,_=make_user()
    job,prop=make_job()
    rooms=[{'id':str(uuid.uuid4()),'type':kind,'label':f'Isolated room {i}','requiredPhoto':True} for i,kind in enumerate(['bedrooms','bedrooms','bathrooms','bathrooms','kitchen','living_room'])]
    config={'version':0,'rooms':rooms,'supplies':[{'id':str(uuid.uuid4()),'name':'Isolated soap'}] if supplies else []}
    config=json.loads(scalar(f"select public.bloom_cleaning_config('{prop}','{payload(config)}','config');",admin))
    for actor in [one,two]: assert action(actor,job,'claim').returncode==0
    sql(f"update public.jobs set checkout_date=current_date-1,start_at=((current_date-1)+time '11:00') at time zone 'America/Detroit',end_at=((current_date-1)+time '15:00') at time zone 'America/Detroit' where id='{job}';")
    scalar(f"select public.bloom_job_start('{job}','start');",one)
    body={'configVersion':config['version'],'answers':[{'supplyId':s['id'],'level':'low'} for s in config['supplies']],'notes':'Isolated report','maintenance':maintenance_answers()}
    return admin,one,two,uid,job,prop,config,body

def finish(actor,job,body,key=None):
    return action(actor,job,'complete',key or str(uuid.uuid4()),f",null,'{payload(body)}'")
def photos(actor,job,config,skip=None):
    for room in config['rooms']:
        if room['id']==skip:continue
        ticket=json.loads(scalar(f"select public.bloom_room_photo_prepare('{job}','{room['id']}','image/png',100,'{room['id']}');",actor))
        # The existing verified-finalize SQL checks ownership and lifecycle. Bytes are tested separately.
        sql(f"select public.bloom_photo_finalize_verified('{actor}','{job}','{ticket['photoId']}',100,'image/png','{room['id']}');",'test-server','service_role')

class JourneyTests(unittest.TestCase):
    def test_concurrent_completion_canonical_event_reports_pay_and_replay(self):
        admin,a,b,uid,job,prop,c,body=fixture();photos(a,job,c)
        with concurrent.futures.ThreadPoolExecutor() as pool:
            results=list(pool.map(lambda actor:finish(actor,job,body,'finish'),[a,b]))
        for r in results:self.assertEqual(r.returncode,0,r.stderr)
        receipts=[json.loads(r.stdout)['receipt'] for r in results]
        self.assertEqual(receipts[0],receipts[1])
        self.assertEqual(scalar(f"select count(*) from public.admin_notification_events where job_id='{job}';"),'1')
        self.assertEqual(scalar(f"select count(*) from public.job_supply_reports where job_id='{job}';"),'1')
        self.assertEqual(scalar(f"select string_agg(completed_pay_cents::text,',' order by slot) from public.assignments where job_id='{job}';"),'3750,3750')
        # A committed response lost in transit replays exactly the original key and payload.
        replay=finish(a,job,body,'finish');self.assertEqual(replay.stdout,results[0].stdout)
        changed={**body,'notes':'different'};self.assertIn('CONFLICT',finish(a,job,changed,'finish').stderr)
        self.assertEqual(scalar(f"select count(*) from public.admin_notification_events where job_id='{job}';",a),'0')
        self.assertEqual(scalar(f"select count(*) from public.admin_notification_events where job_id='{job}';",admin),'1')
    def test_every_actual_room_and_explicit_answers_atomic_rollback(self):
        _,a,_,_,job,_,c,body=fixture();photos(a,job,c,skip=c['rooms'][1]['id'])
        self.assertIn('PHOTO_COVERAGE_REQUIRED',finish(a,job,body).stderr)
        photos(a,job,{'rooms':[c['rooms'][1]]})
        self.assertIn('VALIDATION_ERROR',finish(a,job,{**body,'answers':[]}).stderr)
        self.assertIn('CONFLICT',finish(a,job,{**body,'configVersion':999}).stderr)
        self.assertEqual(scalar(f"select count(*) from public.job_supply_reports where job_id='{job}';"),'0')
        self.assertEqual(scalar(f"select count(*) from public.admin_notification_events where job_id='{job}';"),'0')
        self.assertEqual(finish(a,job,body).returncode,0)
    def test_snapshot_configuration_and_no_supplies(self):
        admin,a,_,_,job,prop,c,body=fixture(False)
        changed={**c,'supplies':[{'id':str(uuid.uuid4()),'name':'New future supply'}]}
        scalar(f"select public.bloom_cleaning_config('{prop}','{payload(changed)}','config2');",admin)
        journey=json.loads(scalar(f"select public.bloom_job_journey('{job}');",a));self.assertEqual(journey['config'],c)
        photos(a,job,c);self.assertEqual(finish(a,job,body).returncode,0)
    def test_permissions_review_and_legacy_bypass(self):
        _,a,_,_,job,prop,c,body=fixture();outsider,_=make_user();owner,_=make_user('owner')
        self.assertIn('NOT_FOUND',sql(f"select public.bloom_cleaning_config('{prop}');",owner,ok=False).stderr)
        self.assertIn('NOT_FOUND',sql(f"select public.bloom_job_journey('{job}');",outsider,ok=False).stderr)
        self.assertIn('NOT_FOUND',finish(outsider,job,body).stderr)
        self.assertIn('CONFLICT',action(a,job,'complete',extra=",null,'{}'").stderr)
        photos(a,job,c);sql(f"update public.jobs set review_required=true where id='{job}';")
        self.assertIn('REVIEW_REQUIRED',finish(a,job,body).stderr)
        self.assertEqual(scalar(f"select count(*) from public.admin_notification_events where job_id='{job}';"),'0')
    def test_pending_photos_do_not_count_and_failed_commit_retries_atomically(self):
        _,a,_,_,job,_,c,body=fixture()
        room=c['rooms'][0]
        scalar(f"select public.bloom_room_photo_prepare('{job}','{room['id']}','image/png',100,'pending');",a)
        photos(a,job,c,skip=room['id'])
        self.assertIn('PHOTO_COVERAGE_REQUIRED',finish(a,job,body).stderr)
        photos(a,job,{'rooms':[room]})
        sql("create function public.test_journey_fail() returns trigger language plpgsql as $$begin raise exception 'SOURCE_UNAVAILABLE';end$$;create trigger test_journey_fail before insert on public.admin_notification_events for each row execute function public.test_journey_fail();")
        try:
            self.assertIn('SOURCE_UNAVAILABLE',finish(a,job,body,'retry-atomic').stderr)
            self.assertEqual(scalar(f"select count(*) from public.job_supply_reports where job_id='{job}';"),'0')
            self.assertEqual(scalar(f"select status from public.jobs where id='{job}';"),'open')
        finally:sql("drop trigger test_journey_fail on public.admin_notification_events;drop function public.test_journey_fail();")
        self.assertEqual(finish(a,job,body,'retry-atomic').returncode,0)
        self.assertEqual(scalar(f"select count(*) from public.admin_notification_events where job_id='{job}';"),'1')
    def test_unconfigured_and_early_start(self):
        a,_=make_user();job,_=make_job();action(a,job,'claim')
        self.assertIn('INVALID_STATE',sql(f"select public.bloom_job_start('{job}','early');",a,ok=False).stderr)
        sql(f"update public.jobs set checkout_date=current_date-1,start_at=((current_date-1)+time '11:00') at time zone 'America/Detroit',end_at=((current_date-1)+time '15:00') at time zone 'America/Detroit' where id='{job}';")
        self.assertIn('CONFIGURATION_ERROR',sql(f"select public.bloom_job_start('{job}','missing');",a,ok=False).stderr)
if __name__=='__main__':unittest.main(verbosity=2)
