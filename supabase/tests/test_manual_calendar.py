"""Actual disposable PostgreSQL tests; JWT claims are simulated, not Clerk verified."""
import concurrent.futures
import json
import unittest
import uuid
from test_database import sql, scalar, make_user, CITY
from test_calendar_database import literal


def call(subject, prop, action, data, key=None, ok=True):
    return sql(f"select public.bloom_property_calendar_action('{prop}','{action}',{literal(data)},'{key or uuid.uuid4().hex}');", subject, ok=ok)


def result(subject, prop, action, data, key=None):
    return json.loads(call(subject, prop, action, data, key).stdout)


def reviewed(subject, prop, data):
    preview = result(subject, prop, 'preview', data)['preview']
    return dict(data, reviewToken=preview['reviewToken'])


def fixture(team=False):
    owner, oid = make_user('owner')
    prop = scalar(f"insert into public.properties(city_id,name,address,owner_created,cleaning_config,private_capacity,private_payer_id,private_total_cents) values('{CITY}','Manual calendar fixture','Synthetic address',true,'{{\"version\":1,\"rooms\":[],\"supplies\":[]}}',2,'{oid}',9000) returning id;")
    sql(f"insert into public.property_owners values('{prop}','{oid}');")
    cleaners = [make_user() for _ in range(2)] if team else []
    for sub, uid in cleaners:
        sql(f"insert into private.property_cleaner_members(property_id,cleaner_id,default_assigned) values('{prop}','{uid}',true);update public.users set bloom_network_enabled=false,approved_city_id=null where id='{uid}';")
    return owner, oid, prop, cleaners


class ManualCalendarTests(unittest.TestCase):
    def conflict(self, value, reason):
        self.assertFalse(value['ok'], value)
        self.assertEqual(value['conflict']['code'], reason)

    def create(self, owner, prop, action, data, key=None):
        value = result(owner, prop, action, reviewed(owner, prop, data), key)
        self.assertTrue(value['ok'], value)
        return value

    def test_owner_isolation_admin_authority_and_cleaner_denial(self):
        owner, _, prop, cleaners = fixture(True)
        stranger, _ = make_user('owner'); admin, _ = make_user('admin')
        for subject in [stranger, cleaners[0][0]]:
            denied = call(subject, prop, 'preview', {'date':'2032-01-10'}, ok=False)
            self.assertNotEqual(denied.returncode, 0)
            self.assertIn('NOT_FOUND', denied.stderr)
        self.assertTrue(result(admin, prop, 'preview', {'date':'2032-01-10'})['ok'])
        self.create(admin, prop, 'create_cleaning', {'date':'2032-01-10'})

    def test_private_defaults_assignment_retry_visibility_and_property_unchanged(self):
        owner, oid, prop, cleaners = fixture(True)
        body = reviewed(owner, prop, {'date':'2032-02-10','instructions':'Only this job'})
        first = result(owner, prop, 'create_cleaning', body, 'same')
        self.assertEqual(result(owner, prop, 'create_cleaning', body, 'same'), first)
        job = first['jobId']
        self.assertEqual(scalar(f"select cleaning_management||':'||payer_owner_id||':'||private_total_cents_snapshot||':'||staffing_capacity from public.jobs where id='{job}';"), f'private:{oid}:9000:2')
        self.assertEqual(scalar(f"select count(*) from public.assignments where job_id='{job}';"),'2')
        self.assertEqual(scalar(f"select count(*) from public.jobs where property_id='{prop}';"),'1')
        outsider, _ = make_user()
        self.assertNotIn(job, scalar("select public.bloom_jobs('2032-02-10','2032-02-10');", outsider))
        self.assertIn(job, scalar("select public.bloom_jobs('2032-02-10','2032-02-10');", cleaners[0][0]))
        self.assertEqual(scalar(f"select private_total_cents from public.properties where id='{prop}';"),'9000')

    def test_pending_bloom_request_stays_private_and_owner_cannot_set_bloom_rate(self):
        owner, _, prop, _ = fixture()
        job = self.create(owner, prop, 'create_cleaning', {'date':'2032-03-10','bloomManaged':True})['jobId']
        self.assertEqual(scalar(f"select cleaning_management||':'||bloom_coverage_requested from public.jobs where id='{job}';"),'private:true')
        body=reviewed(owner, prop, {'date':'2032-03-11','bloomManaged':True,'soloRateCents':12000})
        denied=call(owner,prop,'create_cleaning',body,ok=False)
        self.assertIn('FORBIDDEN',denied.stderr)

    def test_additional_and_in_stay_require_separate_confirmations(self):
        owner, _, prop, _ = fixture()
        self.create(owner,prop,'create_booking',{'checkIn':'2032-04-01','checkout':'2032-04-05'})
        body=reviewed(owner,prop,{'date':'2032-04-03'})
        self.conflict(result(owner,prop,'create_cleaning',body),'IN_STAY_ACK_REQUIRED')
        body['acknowledgeInStay']=True
        self.conflict(result(owner,prop,'create_cleaning',body),'ADDITIONAL_CONFIRMATION_REQUIRED')
        body['confirmAdditional']=True
        self.assertTrue(result(owner,prop,'create_cleaning',body)['ok'])
        self.assertEqual(scalar(f"select check_in||':'||checkout from private.manual_bookings where property_id='{prop}';"),'2032-04-01:2032-04-05')

    def test_adjacent_cross_month_and_occupied_interior(self):
        owner, _, prop, _ = fixture()
        self.create(owner,prop,'create_booking',{'checkIn':'2032-05-30','checkout':'2032-06-02'})
        self.create(owner,prop,'create_booking',{'checkIn':'2032-06-02','checkout':'2032-06-04'})
        body=reviewed(owner,prop,{'checkIn':'2032-05-29','checkout':'2032-06-05'})
        self.conflict(result(owner,prop,'create_booking',body),'UNAVAILABLE_NIGHTS')
        self.assertEqual(scalar(f"select count(*) from private.manual_bookings where property_id='{prop}';"),'2')

    def test_concurrent_booking_and_retry_create_one_checkout(self):
        owner, _, prop, _ = fixture(True)
        body=reviewed(owner,prop,{'checkIn':'2032-07-01','checkout':'2032-07-03'})
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            values=list(pool.map(lambda key:result(owner,prop,'create_booking',body,key),['one','two']))
        self.assertEqual(sum(v['ok'] for v in values),1,values)
        self.conflict(next(v for v in values if not v['ok']),'STALE_REVIEW')
        winning_key=['one','two'][next(i for i,v in enumerate(values) if v['ok'])]
        self.assertEqual(result(owner,prop,'create_booking',body,winning_key),next(v for v in values if v['ok']))
        self.assertEqual(scalar(f"select count(*) from private.manual_bookings where property_id='{prop}';"),'1')
        self.assertEqual(scalar(f"select count(*) from public.jobs where property_id='{prop}';"),'1')
        self.assertEqual(scalar(f"select count(*) from public.assignments a join public.jobs j on j.id=a.job_id where j.property_id='{prop}';"),'2')

    def test_move_requires_assignment_confirmation_keeps_identity_and_audit(self):
        owner, _, prop, _ = fixture(True)
        initial=self.create(owner,prop,'create_booking',{'checkIn':'2032-08-01','checkout':'2032-08-03'})
        job=initial['jobId']; version=int(scalar(f"select version from public.jobs where id='{job}';"))
        body=reviewed(owner,prop,{'date':'2032-08-04','jobId':job,'jobVersion':version,'reason':'Owner requested later cleaning'})
        self.conflict(result(owner,prop,'move_cleaning',body),'ASSIGNMENTS_REQUIRE_CONFIRMATION')
        body['confirmAssignments']=True
        moved=result(owner,prop,'move_cleaning',body)
        self.assertTrue(moved['ok'],moved);self.assertEqual(moved['jobId'],job)
        self.assertEqual(scalar(f"select manual_booking_id||':'||checkout_date||':'||manual_date_override from public.jobs where id='{job}';"),initial['bookingId']+':2032-08-04:true')
        self.assertEqual(scalar(f"select count(*) from public.job_history where job_id='{job}' and action='manual_date_override';"),'1')
        self.assertEqual(scalar(f"select count(*) from public.assignments where job_id='{job}' and ended_at is null;"),'2')

    def test_started_and_completed_cleanings_cannot_move(self):
        for status in ['started','completed']:
            owner, oid, prop, _ = fixture()
            job=self.create(owner,prop,'create_cleaning',{'date':'2032-09-10'})['jobId']
            sql(f"update public.jobs set started_at=start_at"+(f",status='completed',completed_at=now(),completed_by='{oid}'" if status=='completed' else '')+f" where id='{job}';")
            version=int(scalar(f"select version from public.jobs where id='{job}';"))
            body=reviewed(owner,prop,{'date':'2032-09-11','jobId':job,'jobVersion':version,'reason':'Must not move'})
            self.conflict(result(owner,prop,'move_cleaning',body),'PROTECTED_CLEANING')

    def test_explicit_checkout_association_and_booking_edit_preserve_identity(self):
        owner, _, prop, _ = fixture()
        job=self.create(owner,prop,'create_cleaning',{'date':'2032-10-03'})['jobId']
        body=reviewed(owner,prop,{'checkIn':'2032-10-01','checkout':'2032-10-03'})
        self.conflict(result(owner,prop,'create_booking',body),'CHECKOUT_CLEANING_EXISTS')
        body.update(checkoutCleaning='associate',jobId=job,jobVersion=int(scalar(f"select version from public.jobs where id='{job}';")),confirmAssociation=True)
        booking=result(owner,prop,'create_booking',body);self.assertTrue(booking['ok'],booking)
        self.assertEqual(booking['jobId'],job)
        edited=self.create(owner,prop,'edit_booking',{'bookingId':booking['bookingId'],'bookingVersion':booking['version'],'checkIn':'2032-10-01','checkout':'2032-10-04','reason':'Extend stay'})
        self.assertEqual(edited['bookingId'],booking['bookingId'])
        self.assertEqual(scalar(f"select checkout_date from public.jobs where id='{job}';"),'2032-10-04')
        self.assertEqual(scalar(f"select count(*) from public.jobs where property_id='{prop}';"),'1')

    def test_explicit_private_amounts_and_bloom_authorized_rates(self):
        owner, oid, prop, cleaners = fixture(True)
        job=self.create(owner,prop,'create_cleaning',{'date':'2032-12-01','capacity':2,'totalCents':10000,'cleaners':[{'cleanerId':cleaners[0][1],'amountCents':3000},{'cleanerId':cleaners[1][1],'amountCents':7000}]})['jobId']
        self.assertEqual(scalar(f"select string_agg(agreed_pay_cents::text,',' order by agreed_pay_cents) from public.assignments where job_id='{job}';"),'3000,7000')
        self.assertEqual(scalar(f"select private_total_cents from public.properties where id='{prop}';"),'9000')
        sql(f"update public.properties set bloom_approved=true where id='{prop}';")
        job=self.create(owner,prop,'create_cleaning',{'date':'2032-12-02','bloomManaged':True})['jobId']
        self.assertEqual(scalar(f"select cleaning_management||':'||solo_rate_cents_snapshot||':'||(payer_owner_id is null)||':'||staffing_capacity from public.jobs where id='{job}';"),'bloom:7500:true:2')
        self.assertEqual(scalar(f"select cleaning_management from public.properties where id='{prop}';"),'private')
        admin,_=make_user('admin')
        job=self.create(admin,prop,'create_cleaning',{'date':'2032-12-03','bloomManaged':True,'soloRateCents':10000})['jobId']
        self.assertEqual(scalar(f"select solo_rate_cents_snapshot from public.jobs where id='{job}';"),'10000')

    def test_property_local_dst_window_and_nonexistent_time(self):
        owner, _, prop, _ = fixture()
        job=self.create(owner,prop,'create_cleaning',{'date':'2032-03-14','startTime':'11:00','endTime':'15:00'})['jobId']
        self.assertEqual(scalar(f"select to_char(start_at at time zone 'UTC','HH24:MI') from public.jobs where id='{job}';"),'15:00')
        denied=call(owner,prop,'preview',{'date':'2032-03-14','startTime':'02:30','endTime':'04:00'},ok=False)
        self.assertNotEqual(denied.returncode,0);self.assertIn('VALIDATION_ERROR',denied.stderr)

    def test_blocked_or_unconfirmed_imported_night_denies_booking(self):
        from test_calendar_database import source, sync, event
        for kind in ['blocked','unknown']:
            owner, _, prop, _ = fixture()
            admin, aid=make_user('admin')
            _, _, sid, _=source(aid,prop)
            sync(aid,sid,[event(start='2033-01-31',end='2033-02-02',kind=kind,reviewRequired=kind=='unknown')])
            body=reviewed(owner,prop,{'checkIn':'2033-01-30','checkout':'2033-02-03'})
            value=result(owner,prop,'create_booking',body)
            self.conflict(value,'UNAVAILABLE_NIGHTS')
            self.assertIn(value['conflict']['details']['periods'][0]['reason'],['BLOCKED','UNRESOLVED_SOURCE'])

    def test_import_sync_preserves_manual_booking_and_moved_cleaning(self):
        from test_calendar_database import source, sync, event
        owner, _, prop, _ = fixture(True)
        _, aid=make_user('admin')
        _, _, sid, _=source(aid,prop)
        imported=event(start='2033-04-01',end='2033-04-03')
        sync(aid,sid,[imported])
        job=scalar(f"select id from public.jobs where property_id='{prop}';")
        version=int(scalar(f"select version from public.jobs where id='{job}';"))
        self.create(owner,prop,'move_cleaning',{'date':'2033-04-04','jobId':job,'jobVersion':version,'reason':'Intentional override','confirmAssignments':True})
        self.create(owner,prop,'create_booking',{'checkIn':'2033-05-01','checkout':'2033-05-03'})
        sync(aid,sid,[imported])
        self.assertEqual(scalar(f"select checkout_date from public.jobs where id='{job}';"),'2033-04-04')
        self.assertEqual(scalar(f"select count(*) from private.manual_bookings where property_id='{prop}' and status='active';"),'1')
        self.assertEqual(scalar(f"select count(*) from public.jobs where property_id='{prop}';"),'2')
        self.assertEqual(scalar(f"select count(*) from public.assignments where job_id='{job}' and ended_at is null;"),'2')
        sync(aid,sid,[event(start='2033-04-01',end='2033-04-05')])
        self.assertEqual(scalar(f"select checkout_date||':'||review_required from public.jobs where id='{job}';"),'2033-04-04:true')
        self.assertEqual(scalar(f"select count(*) from public.jobs where property_id='{prop}';"),'2')
        self.assertEqual(scalar(f"select count(*) from public.assignments where job_id='{job}' and ended_at is null;"),'2')

if __name__ == '__main__': unittest.main()
