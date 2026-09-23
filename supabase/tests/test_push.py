"""Real disposable PostgreSQL; synthetic identities and no provider sends."""
import concurrent.futures
import json
import unittest
import uuid
from test_database import sql, scalar, make_user, make_job, CITY
from test_calendar_database import source, sync, event

def call(name, args):
    return sql(f"select public.bloom_push_{name}({args});").stdout.strip() or "null"

class PushTests(unittest.TestCase):
    def setUp(self):
        sql("truncate private.push_deliveries,private.push_messages,private.push_publications,private.push_devices,private.push_preferences; update private.push_control set activated_at=null;")
        self.sub,self.user=make_user()
        self.device=uuid.uuid4().hex*2
        self.subscription=str(uuid.uuid4())
        self.bind()
        self.prefs(True,True)
    def bind(self):
        self.device_action('challenge',{'subscription':self.subscription,'hash':'a'*64})
        self.device_action('verify',{'hash':'a'*64})
    def device_action(self,action,body=None,user=None,session='session_one'):
        return call('device',f"'{self.device}','{user or self.user}','{session}','{action}','{json.dumps(body or {})}'")
    def prefs(self,new,reminders):
        self.device_action('preferences',{'newJobs':new,'reminders':reminders})
    def activate(self):
        sql('select public.bloom_push_activate();')
    def tick(self,at=None):
        return call('tick',f"'{at}'" if at else '')
    def content(self,kind,at):
        return json.loads(scalar(f"select coalesce(private.push_content(id,'{at}'),'null'::jsonb) from private.push_messages where user_id='{self.user}' and kind='{kind}' order by created_at desc limit 1;"))
    def test_activation_baseline_batch_and_sync_replay(self):
        historical,_=make_job();self.activate();self.tick()
        self.assertEqual(scalar('select count(*) from private.push_messages;'),'0')
        j1,_=make_job(review=True);j2,_=make_job(review=True)
        sql(f"begin;update public.jobs set review_required=false where id in ('{j1}','{j2}');commit;")
        self.tick();self.tick()
        self.assertEqual(scalar(f"select count(*) from private.push_messages where user_id='{self.user}';"),'1')
        self.assertEqual(scalar(f"select private.push_content(id,now())->>'count' from private.push_messages where user_id='{self.user}';"),'2')
        sql(f"update public.jobs set version=version+1 where id in ('{j1}','{j2}','{historical}');")
        self.tick();self.assertEqual(scalar('select count(*) from private.push_messages;'),'1')
    def test_real_calendar_import_batches_and_repeated_sync(self):
        self.activate();actor,prop,sid,_=source()
        events=[event(uid='batch-a',start='2030-05-01',end='2030-05-03'),event(uid='batch-b',start='2030-05-04',end='2030-05-06')]
        sync(actor,sid,events);self.tick()
        self.assertEqual(scalar(f"select count(*) from private.push_messages where user_id='{self.user}' and kind='new';"),'1')
        self.assertEqual(scalar(f"select private.push_content(id,now())->>'count' from private.push_messages where user_id='{self.user}';"),'2')
        self.assertIn('date=2030-05-03',scalar(f"select private.push_content(id,now())->>'url' from private.push_messages where user_id='{self.user}';"))
        sync(actor,sid,events);self.tick()
        self.assertEqual(scalar(f"select count(*) from private.push_messages where user_id='{self.user}';"),'1')
    def test_city_preferences_availability_and_private_permissions(self):
        self.activate();other_city=scalar("insert into public.cities(name) values(gen_random_uuid()::text) returning id;")
        make_job(city=other_city);self.tick();self.assertEqual(scalar('select count(*) from private.push_messages;'),'0')
        self.prefs(False,True);make_job();self.tick();self.assertEqual(scalar('select count(*) from private.push_messages;'),'0')
        self.prefs(True,True);job,_=make_job();self.tick()
        sql(f"update public.jobs set status='cancelled' where id='{job}';")
        self.assertEqual(scalar('select private.push_content(id,now()) is null from private.push_messages;'),'t')
        self.assertNotEqual(sql('select * from private.push_devices;',self.sub,ok=False).returncode,0)
        self.assertNotEqual(sql('select public.bloom_push_tick();',self.sub,ok=False).returncode,0)
    def test_summaries_current_assignments_and_late_claims(self):
        self.activate();j1,_=make_job(day="date '2027-07-02'");j2,_=make_job(day="date '2027-07-02'")
        sql(f"insert into public.assignments(job_id,cleaner_id,slot,claimed_at) values('{j1}','{self.user}',1,'2027-07-01 20:00Z');")
        self.tick('2027-07-01 22:00Z');self.assertEqual(self.content('evening','2027-07-01 22:01Z')['count'],1)
        sql(f"insert into public.assignments(job_id,cleaner_id,slot,claimed_at) values('{j2}','{self.user}',1,'2027-07-02 01:00Z');")
        self.tick('2027-07-02 12:00Z');self.assertEqual(self.content('morning','2027-07-02 12:01Z')['count'],2)
        sql(f"update public.jobs set status='cancelled' where id='{j1}';")
        self.assertEqual(self.content('morning','2027-07-02 12:01Z')['count'],1)
        sql(f"update public.jobs set status='open' where id='{j1}';")
        sql(f"update public.assignments set ended_at='2027-07-02 12:01Z',end_reason='withdrawn' where job_id='{j1}';")
        self.assertEqual(self.content('morning','2027-07-02 12:02Z')['count'],1)
        sql(f"update public.jobs set status='completed',completed_at='2027-07-02 12:02Z',completed_by='{self.user}' where id='{j2}';")
        self.assertIsNone(self.content('morning','2027-07-02 12:03Z'))
        j3,_=make_job(day="date '2027-07-02'")
        sql(f"insert into public.assignments(job_id,cleaner_id,slot,claimed_at) values('{j3}','{self.user}',1,'2027-07-02 12:01Z');")
        self.tick('2027-07-02 12:02Z');self.assertIsNone(self.content('morning','2027-07-02 12:03Z'))
        self.assertEqual(scalar(f"select count(*) from private.push_messages where user_id='{self.user}' and kind='morning';"),'1')
    def test_dst_and_no_catchup(self):
        self.activate()
        for day,utc in [('2027-03-13','13:00'),('2027-03-14','12:00'),('2027-11-06','12:00'),('2027-11-07','13:00')]:
            job,_=make_job(day=f"date '{day}'")
            sql(f"insert into public.assignments(job_id,cleaner_id,slot,claimed_at) values('{job}','{self.user}',1,'2026-01-01Z');")
            self.tick(f'{day} {utc}Z')
            self.assertEqual(scalar(f"select to_char(cutoff at time zone 'UTC','HH24:MI') from private.push_messages where kind='morning' and job_date='{day}' and user_id='{self.user}';"),utc)
            self.assertIsNone(self.content('morning',f'{day} 18:00Z'))
        job,_=make_job(day="date '2027-12-10'")
        sql(f"insert into public.assignments(job_id,cleaner_id,slot,claimed_at) values('{job}','{self.user}',1,'2026-01-01Z');")
        self.tick('2027-12-10 13:11Z')
        self.assertEqual(scalar("select count(*) from private.push_messages where kind='morning' and job_date='2027-12-10';"),'0')
    def test_concurrency_leases_and_bounded_retry(self):
        self.activate();make_job()
        with concurrent.futures.ThreadPoolExecutor() as pool:list(pool.map(lambda _:self.tick(),range(4)))
        self.assertEqual(scalar('select count(*) from private.push_deliveries;'),'1')
        with concurrent.futures.ThreadPoolExecutor() as pool:rows=list(pool.map(lambda _:json.loads(call('take','5')),range(4)))
        leases=[r for row in rows for r in row];self.assertEqual(len(leases),1);lease=leases[0]
        call('finish',f"'{lease['id']}','{uuid.uuid4()}','accepted'")
        self.assertEqual(scalar('select state from private.push_deliveries;'),'attempted')
        for attempt in range(4):
            call('finish',f"'{lease['id']}','{lease['lease']}','pending',null,'TRANSIENT'")
            if attempt<3:
                sql("update private.push_deliveries set next_attempt=now()-interval '1 second';")
                lease=json.loads(call('take','5'))[0]
        self.assertEqual(scalar('select state from private.push_deliveries;'),'failed')
        self.assertEqual(scalar('select attempts from private.push_deliveries;'),'4')
    def test_proof_switch_logout_multiple_devices_and_tests_are_device_only(self):
        self.activate();make_job();self.tick();row=json.loads(call('take','5'))[0]
        self.assertIsNotNone(json.loads(call('delivery',f"'{row['id']}','{row['lease']}'")))
        _,other=make_user();self.device_action('status',user=other,session='session_two')
        self.assertIsNone(json.loads(call('delivery',f"'{row['id']}','{row['lease']}'")))
        proof=sql(f"select public.bloom_push_device('{self.device}','{other}','session_two','verify','{{\"hash\":\"{'b'*64}\"}}');",ok=False)
        self.assertNotEqual(proof.returncode,0)
        self.device_action('status');sql(f"update private.push_devices set last_test_at=null where id='{self.device}';");self.bind()
        sql(f"update private.push_devices set last_test_at=null where id='{self.device}';")
        second=uuid.uuid4().hex*2
        sql(f"insert into private.push_devices(id,user_id,session_id,subscription_id,verified) values('{second}','{self.user}','session_other','{uuid.uuid4()}',true);")
        result=json.loads(self.device_action('test',{'key':'test-one'}))
        only=json.loads(call('take',f"5,'{result['testDeliveryId']}'"))
        self.assertEqual(len(only),1)
        self.assertEqual(only[0]['id'],result['testDeliveryId'])
        self.assertEqual(scalar("select count(*) from private.push_deliveries d join private.push_messages m on m.id=d.message_id where m.kind='test';"),'1')
        self.device_action('detach');self.assertEqual(scalar(f"select verified from private.push_devices where id='{self.device}';"),'f')
        self.assertEqual(scalar(f"select verified from private.push_devices where id='{second}';"),'t')

if __name__=='__main__':unittest.main(verbosity=2)
