from test_database import configure_completion_fixture
"""Service RPC tests against disposable PostgreSQL, with simulated gateway role/claims."""
import concurrent.futures
import hashlib
import json
import os
import subprocess
import unittest
import uuid
from test_database import sql, scalar, make_user, action, CITY

def literal(v):
    if v is None:return 'null'
    if isinstance(v, (dict,list)):return "'"+json.dumps(v).replace("'","''")+"'::jsonb"
    if isinstance(v,int):return str(v)
    return "'"+str(v).replace("'","''")+"'"

def rpc(name,args,ok=True,subject='server',role='service_role'):
    return sql('select public.'+name+'('+','.join(k+'=>'+literal(v) for k,v in args.items())+');',subject,role,ok)

def data(result):return json.loads(result.stdout.strip())
def event(uid='synthetic-event',start='2030-05-01',end='2030-05-03',**extra):
    e=dict(uid=uid,recurrenceKey='',startDate=start,endDate=end,kind='reservation',status='active',evidence='airbnb-reservation-link',reviewRequired=False)
    e.update(extra);e['contentHash']=hashlib.sha256(json.dumps(e,sort_keys=True).encode()).hexdigest();return e

def snapshot(events,complete=True):return dict(events=events,issues=[] if complete else [dict(code='EVENT_REVIEW_REQUIRED')],complete=complete,coverage=None)

def source(actor=None,prop=None,provider='airbnb',fingerprint=None):
    if actor is None:_,actor=make_user('admin')
    if prop is None:prop=scalar(f"insert into public.properties(city_id,name,address) values('{CITY}','Synthetic calendar unit','Development fixture') returning id;")
    body=dict(propertyId=prop,provider=provider,encryptedUrl='v1.'+'a'*16+'.'+'b'*22+'.'+'c'*80,fingerprint=fingerprint or uuid.uuid4().hex*2,urlDigest='d'*64)
    result=data(rpc('bloom_calendar_add_source',dict(p_actor=actor,p_input=body,p_key=uuid.uuid4().hex)))
    return actor,prop,result['id'],body

def begin(actor,source,key=None):return data(rpc('bloom_calendar_begin_sync',dict(p_actor=actor,p_source=source,p_key=key or uuid.uuid4().hex)))
def finish(actor,lease,snap,validators=None,ok=True):return rpc('bloom_calendar_finish_sync',dict(p_actor=actor,p_source=lease['source']['id'],p_run=lease['runId'],p_version=lease['version'],p_snapshot=snap,p_validators=validators or {}),ok)
def sync(actor,source,events):return data(finish(actor,begin(actor,source),snapshot(events)))

class CalendarDatabaseTests(unittest.TestCase):
    def error(self,result,code):
        self.assertNotEqual(result.returncode,0,result.stdout);self.assertIn(code,result.stderr)
    def test_source_setup_receipts_rotation_and_redaction(self):
        actor,prop,sid,body=source();key='setup'
        first=data(rpc('bloom_calendar_add_source',dict(p_actor=actor,p_input=body,p_key=key)))
        body2={**body,'encryptedUrl':'v1.'+'d'*16+'.'+'e'*22+'.'+'f'*80}
        self.assertEqual(data(rpc('bloom_calendar_add_source',dict(p_actor=actor,p_input=body2,p_key=key))),first)
        self.assertEqual(scalar(f"select count(*) from public.calendar_sources where property_id='{prop}';"),'1')
        self.error(rpc('bloom_calendar_add_source',dict(p_actor=actor,p_input={**body,'urlDigest':'e'*64},p_key=key),False),'CONFLICT')
        lease=begin(actor,sid)
        rpc('bloom_calendar_add_source',dict(p_actor=actor,p_input={**body2,'urlDigest':'e'*64},p_key='rotate'))
        self.error(finish(actor,lease,snapshot([]),ok=False),'CONFLICT')
        page=data(rpc('bloom_calendar_sources',dict(p_actor=actor,p_cursor=None)))
        self.assertEqual(set(first),{'id','propertyId','provider','enabled','lastSuccessAt','lastAttemptAt','errorCode','action'})
        self.assertNotIn('encryptedUrl',json.dumps(page));self.assertNotIn('fingerprint',json.dumps(page))
    def test_service_rpc_denial_and_actor_validation(self):
        actor,prop,sid,body=source();owner,ownerid=make_user('owner')
        calls=[('bloom_calendar_add_source',dict(p_actor=actor,p_input=body,p_key='x')),('bloom_calendar_sources',dict(p_actor=actor,p_cursor=None)),('bloom_calendar_enabled_sources',dict(p_actor=None,p_cursor=None)),('bloom_calendar_begin_sync',dict(p_actor=actor,p_source=sid,p_key='x')),('bloom_calendar_finish_sync',dict(p_actor=actor,p_source=sid,p_run=str(uuid.uuid4()),p_version=1,p_snapshot=None,p_validators={})),('bloom_calendar_fail_sync',dict(p_actor=actor,p_source=sid,p_run=str(uuid.uuid4()),p_version=1,p_code='SYNC_FAILED'))]
        for name,args in calls:
            for role in ['anon','authenticated']:self.error(rpc(name,args,False,owner,role),'permission denied')
        self.error(rpc('bloom_calendar_sources',dict(p_actor=ownerid,p_cursor=None),False),'FORBIDDEN')
        self.error(rpc('bloom_calendar_add_source',dict(p_actor=None,p_input=body,p_key='x'),False),'FORBIDDEN')
        self.error(sql('select * from public.calendar_sources;',owner,ok=False),'permission denied')
    def test_concurrent_begin_and_duplicate_source_setup(self):
        actor,prop,sid,body=source()
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            result=list(pool.map(lambda i:rpc('bloom_calendar_add_source',dict(p_actor=actor,p_input=body,p_key='add-'+str(i)),False),range(3)))
        self.assertTrue(all(x.returncode==0 for x in result),[x.stderr for x in result])
        self.assertEqual(scalar(f"select count(*) from public.calendar_sources where property_id='{prop}';"),'1')
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            result=list(pool.map(lambda i:rpc('bloom_calendar_begin_sync',dict(p_actor=actor,p_source=sid,p_key='begin-'+str(i)),False),range(3)))
        self.assertEqual(sum(x.returncode==0 for x in result),1,[x.stderr for x in result])
        self.assertEqual(sum('CONFLICT' in x.stderr for x in result),2)
    def test_identical_resync_and_concurrent_finish(self):
        actor,prop,sid,_=source();lease=begin(actor,sid,'same');snap=snapshot([event()])
        self.assertEqual(begin(actor,sid,'same'),lease)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:finish(actor,lease,snap,ok=False),range(2)))
        self.assertTrue(all(r.returncode==0 for r in results),[r.stderr for r in results]);self.assertEqual(results[0].stdout,results[1].stdout)
        self.assertEqual(begin(actor,sid,'same'),{'result':data(results[0])})
        old=scalar(f"select count(*) from public.job_history h join public.jobs j on j.id=h.job_id where j.property_id='{prop}';")
        result=sync(actor,sid,[event()]);self.assertEqual(result['unchanged'],1)
        self.assertEqual(scalar(f"select count(*) from public.job_history h join public.jobs j on j.id=h.job_id where j.property_id='{prop}';"),old)
        self.assertEqual(scalar(f"select count(*) from public.jobs where property_id='{prop}';"),'1')
        self.error(finish(actor,lease,snapshot([event(end='2030-05-04')]),ok=False),'CONFLICT')
    def test_expired_leases_stale_failure_and_scheduler_receipts(self):
        actor,prop,sid,_=source();lease=begin(None,sid,'scheduler-key')
        sql(f"update public.calendar_sources set lease_expires_at=clock_timestamp()-interval '1 second' where id='{sid}';")
        self.error(finish(None,lease,snapshot([]),ok=False),'CONFLICT')
        newer=begin(None,sid,'next')
        rpc('bloom_calendar_fail_sync',dict(p_actor=None,p_source=sid,p_run=lease['runId'],p_version=lease['version'],p_code='FETCH_FAILED'))
        self.assertEqual(scalar(f"select active_run_id from public.calendar_sources where id='{sid}';"),newer['runId'])
        _,_,other,_=source(actor)
        self.error(rpc('bloom_calendar_begin_sync',dict(p_actor=None,p_source=other,p_key='scheduler-key'),False),'CONFLICT')
        self.error(finish(actor,newer,snapshot([]),ok=False),'FORBIDDEN')
        self.assertEqual(data(finish(None,newer,snapshot([])))['status'],'success')
    def test_partial_and_304_preserve_state(self):
        actor,prop,sid,_=source();finish(actor,begin(actor,sid),snapshot([event()]),{'etag':'original','lastModified':'Mon, 01 Jan 2024 00:00:00 GMT'})
        before=scalar(f"select jsonb_build_object('success',last_success_at,'etag',etag,'modified',last_modified) from public.calendar_sources where id='{sid}';")
        events=scalar(f"select jsonb_agg(e) from public.calendar_events e where source_id='{sid}';")
        result=data(finish(actor,begin(actor,sid),snapshot([event(end='2030-05-06')],False),{'etag':'must-not-stick'}))
        self.assertEqual(result['status'],'partial')
        self.assertEqual(scalar(f"select jsonb_build_object('success',last_success_at,'etag',etag,'modified',last_modified) from public.calendar_sources where id='{sid}';"),before)
        self.assertEqual(scalar(f"select jsonb_agg(e) from public.calendar_events e where source_id='{sid}';"),events)
        self.assertEqual(data(finish(actor,begin(actor,sid),None,{'etag':'ignore-304'}))['status'],'not_modified')
        self.assertEqual(scalar(f"select etag from public.calendar_sources where id='{sid}';"),'original')
        self.assertEqual(scalar(f"select jsonb_agg(e) from public.calendar_events e where source_id='{sid}';"),events)
    def test_missing_preserves_job_on_hold(self):
        actor,prop,sid,_=source();sync(actor,sid,[event()]);sync(actor,sid,[])
        self.assertEqual(scalar(f"select status||':'||review_required from public.jobs where property_id='{prop}';"),'open:true')
        self.assertEqual(scalar(f"select missing_reason from public.calendar_events where source_id='{sid}';"),'horizon_unknown')
        notices=scalar(f"select count(*) from public.calendar_changes c join public.calendar_events e on e.id=c.event_id where e.source_id='{sid}';")
        sync(actor,sid,[])
        self.assertEqual(scalar(f"select count(*) from public.calendar_changes c join public.calendar_events e on e.id=c.event_id where e.source_id='{sid}';"),notices)
    def test_changed_claimed_job_has_no_replacement(self):
        actor,prop,sid,_=source();sync(actor,sid,[event()]);job=scalar(f"select id from public.jobs where property_id='{prop}';")
        cleaner,_=make_user();self.assertEqual(action(cleaner,job,'claim').returncode,0)
        sync(actor,sid,[event(end='2030-05-05')]);sync(actor,sid,[event(end='2030-05-05')])
        self.assertEqual(scalar(f"select count(*) from public.jobs where property_id='{prop}';"),'1')
        self.assertEqual(scalar(f"select checkout_date||':'||review_required from public.jobs where id='{job}';"),'2030-05-03:true')
    def test_two_feeds_same_turnover_and_append_only_links(self):
        actor,prop,s1,_=source();_,_,s2,_=source(actor,prop)
        leases=[begin(actor,s1),begin(actor,s2)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda i:finish(actor,leases[i],snapshot([event(uid='feed-'+str(i))]),ok=False),range(2)))
        self.assertTrue(all(r.returncode==0 for r in results),[r.stderr for r in results])
        self.assertEqual(scalar(f"select count(*) from public.jobs where property_id='{prop}';"),'1')
        self.assertEqual(scalar(f"select count(*) from public.job_events je join public.jobs j on j.id=je.job_id where j.property_id='{prop}';"),'2')
        self.assertEqual(scalar(f"select review_required from public.jobs where property_id='{prop}';"),'f')
        sync(actor,s1,[event(uid='feed-0',status='cancelled')])
        self.assertEqual(scalar(f"select status from public.jobs where property_id='{prop}';"),'open')
        self.error(sql('delete from public.job_event_history;',ok=False),'INVALID_STATE')
    def test_completed_history_and_changed_uid_same_date(self):
        actor,prop,sid,_=source();sync(actor,sid,[event(start='2025-01-01',end='2025-01-03')])
        job=scalar(f"select id from public.jobs where property_id='{prop}';")
        cleaner,cid=make_user()
        sql(f"insert into public.assignments(job_id,cleaner_id,slot) values('{job}','{cid}',1);")
        for cat in ['bedrooms','bathrooms','kitchen','living_room']:
            sql(f"insert into public.job_photos(job_id,uploader_id,category,object_path,state,bytes,mime) values('{job}','{cid}','{cat}','{job}/{cat}','ready',100,'image/png');")
        configure_completion_fixture(job)
        self.assertEqual(action(cleaner,job,'complete').returncode,0)
        frozen=scalar(f"select to_jsonb(j) from public.jobs j where id='{job}';")
        pay=scalar(f"select jsonb_agg(a) from public.assignments a where job_id='{job}';")
        sync(actor,sid,[event(start='2025-01-01',end='2025-01-05')])
        self.assertEqual(scalar(f"select count(*) from public.jobs where property_id='{prop}';"),'1')
        sync(actor,sid,[event(uid='new-uid',start='2025-01-01',end='2025-01-03')])
        self.assertEqual(scalar(f"select count(*) from public.jobs where property_id='{prop}';"),'1')
        self.assertEqual(scalar(f"select to_jsonb(j) from public.jobs j where id='{job}';"),frozen)
        self.assertEqual(scalar(f"select jsonb_agg(a) from public.assignments a where job_id='{job}';"),pay)
        self.assertGreater(int(scalar(f"select count(*) from public.job_history where job_id='{job}' and action like 'calendar_%';")),1)
    def test_cancellation_claim_and_completion_races(self):
        actor,prop,sid,_=source();sync(actor,sid,[event()]);job=scalar(f"select id from public.jobs where property_id='{prop}';")
        cleaner,cid=make_user();lease=begin(actor,sid)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            f=pool.submit(finish,actor,lease,snapshot([event(status='cancelled')]),None,False)
            c=pool.submit(action,cleaner,job,'claim');fr,cr=f.result(),c.result()
        self.assertEqual(fr.returncode,0,fr.stderr)
        if cr.returncode==0:self.assertEqual(scalar(f"select status||':'||review_required from public.jobs where id='{job}';"),'open:true')
        else:self.assertIn('INVALID_STATE',cr.stderr);self.assertEqual(scalar(f"select status from public.jobs where id='{job}';"),'cancelled')
        actor,prop,sid,_=source();old=event(start='2025-02-01',end='2025-02-02');sync(actor,sid,[old]);job=scalar(f"select id from public.jobs where property_id='{prop}';")
        sql(f"insert into public.assignments(job_id,cleaner_id,slot) values('{job}','{cid}',1);")
        for cat in ['bedrooms','bathrooms','kitchen','living_room']:
            sql(f"insert into public.job_photos(job_id,uploader_id,category,object_path,state,bytes,mime) values('{job}','{cid}','{cat}','{job}/{cat}','ready',100,'image/png');")
        configure_completion_fixture(job)
        lease=begin(actor,sid)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            f=pool.submit(finish,actor,lease,snapshot([event(start='2025-02-01',end='2025-02-02',status='cancelled')]),None,False)
            c=pool.submit(action,cleaner,job,'complete');fr,cr=f.result(),c.result()
        self.assertEqual(fr.returncode,0,fr.stderr)
        if cr.returncode==0:self.assertEqual(scalar(f"select completed_pay_cents from public.assignments where job_id='{job}';"),'7500')
        else:self.assertIn('REVIEW_REQUIRED',cr.stderr);self.assertEqual(scalar(f"select status from public.jobs where id='{job}';"),'open')
    def test_admin_reschedule_sync_and_setup_begin_lock_order(self):
        actor,prop,sid,body=source();admin=scalar(f"select clerk_user_id from public.users where id='{actor}';")
        sync(actor,sid,[event()]);job=scalar(f"select id from public.jobs where property_id='{prop}';")
        sql(f"update public.jobs set review_required=true where id='{job}';")
        lease=begin(actor,sid);payload=json.dumps({'reason':'Synthetic resolution','checkoutDate':'2030-05-05'})
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            f=pool.submit(finish,actor,lease,snapshot([event(end='2030-05-05')]),None,False)
            a=pool.submit(action,admin,job,'reschedule',None,",1,'"+payload+"'");fr,ar=f.result(),a.result()
        self.assertEqual(fr.returncode,0,fr.stderr)
        if ar.returncode:self.assertIn('CONFLICT',ar.stderr)
        self.assertNotIn('deadlock',ar.stderr+fr.stderr)
        self.assertEqual(scalar(f"select count(*) from public.jobs where property_id='{prop}';"),'1')
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            a=pool.submit(rpc,'bloom_calendar_add_source',dict(p_actor=actor,p_input={**body,'urlDigest':'e'*64},p_key='rotate-race'),False)
            b=pool.submit(rpc,'bloom_calendar_begin_sync',dict(p_actor=actor,p_source=sid,p_key='begin-race'),False)
            ar,br=a.result(),b.result()
        self.assertEqual(ar.returncode,0,ar.stderr);self.assertEqual(br.returncode,0,br.stderr)
        self.assertNotIn('deadlock',ar.stderr+br.stderr)
    def test_overlap_and_repeated_transitions_have_durable_notices(self):
        actor,prop,sid,_=source()
        sync(actor,sid,[event('a'),event('b',start='2030-05-02',end='2030-05-04')])
        self.assertEqual(scalar(f"select count(*) from public.jobs where property_id='{prop}' and review_required;"),'2')
        original=scalar(f"select count(*) from public.calendar_changes c join public.calendar_events e on e.id=c.event_id where source_id='{sid}';")
        sync(actor,sid,[event('a'),event('b',start='2030-05-02',end='2030-05-04')])
        self.assertEqual(scalar(f"select count(*) from public.calendar_changes c join public.calendar_events e on e.id=c.event_id where source_id='{sid}';"),original)
        for end in ['2030-05-05','2030-05-04','2030-05-05']:
            sync(actor,sid,[event('a'),event('b',start='2030-05-02',end=end)])
        self.assertEqual(scalar(f"select transition_version from public.calendar_events where source_id='{sid}' and uid='b';"),'4')
        self.assertGreater(int(scalar(f"select count(*) from public.calendar_changes c join public.calendar_events e on e.id=c.event_id where source_id='{sid}';")),int(original))
    def test_expiry_is_rechecked_after_waiting_for_job_lock(self):
        actor,prop,sid,_=source();sync(actor,sid,[event()]);lease=begin(actor,sid)
        job=scalar(f"select id from public.jobs where property_id='{prop}';")
        cmd=[os.environ.get('BLOOM_PSQL','psql'),'-h','127.0.0.1','-p',os.environ.get('BLOOM_TEST_PORT','55439'),'-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1']
        holder=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        holder.stdin.write(f"begin;select id from public.jobs where id='{job}' for update;select pg_sleep(1);commit;\n")
        holder.stdin.close()
        self.assertEqual(holder.stdout.readline().strip(),job)
        sql(f"update public.calendar_sources set lease_expires_at=clock_timestamp()+interval '100 milliseconds' where id='{sid}';")
        result=finish(actor,lease,snapshot([event(end='2030-05-05')]),ok=False)
        holder.wait(timeout=5)
        holder.stdout.close();holder.stderr.close()
        self.error(result,'CONFLICT')
        self.assertEqual(scalar(f"select end_local_date from public.calendar_events where source_id='{sid}';"),'2030-05-03')
    def test_health_and_enabled_source_keyset_pagination(self):
        actor,prop,sid,_=source()
        sql(f"insert into public.calendar_sources(property_id,provider,encrypted_url,fingerprint,url_digest) select '{prop}','airbnb','synthetic',lpad(i::text,64,'0'),'digest' from generate_series(1,102)i;")
        ids=[];cursor=None
        while True:
            page=data(rpc('bloom_calendar_sources',dict(p_actor=actor,p_cursor=cursor)))
            self.assertLessEqual(len(page['items']),100)
            ids.extend(item['id'] for item in page['items']);cursor=page['nextCursor']
            if cursor is None:break
        self.assertEqual(len(ids),len(set(ids)))
        self.assertEqual(len(ids),int(scalar('select count(*) from public.calendar_sources;')))
        enabled=data(rpc('bloom_calendar_enabled_sources',dict(p_actor=None,p_cursor=None)))
        self.assertEqual(len(enabled['ids']),100);self.assertIsNotNone(enabled['nextCursor'])
    def test_owner_freshness_details_and_verified_name(self):
        actor,prop,sid,_=source();owner,oid=make_user('owner');other,_=make_user('owner')
        sql(f"insert into public.property_owners values('{prop}','{oid}');")
        own=data(rpc('bloom_owner_source_freshness',dict(p_cursor=None),subject=owner,role='authenticated'))
        self.assertEqual(len(own),1);self.assertEqual(set(own[0]),{'propertyId','lastSuccessAt','message'});self.assertIsNone(own[0]['lastSuccessAt'])
        self.assertEqual(data(rpc('bloom_owner_source_freshness',dict(p_cursor=None),subject=other,role='authenticated')),[])
        sync(actor,sid,[event()]);job=scalar(f"select id from public.jobs where property_id='{prop}';")
        self.assertIsNotNone(data(rpc('bloom_owner_source_freshness',dict(p_cursor=None),subject=owner,role='authenticated'))[0]['lastSuccessAt'])
        cleaner,cid=make_user();self.error(rpc('bloom_assigned_job_detail',dict(p_job=job),False,cleaner,'authenticated'),'NOT_FOUND')
        self.error(rpc('bloom_assigned_job_detail',dict(p_job=job),False,owner,'authenticated'),'NOT_FOUND')
        self.assertEqual(action(cleaner,job,'claim').returncode,0)
        self.assertEqual(set(data(rpc('bloom_assigned_job_detail',dict(p_job=job),subject=cleaner,role='authenticated'))),{'address','instructions'})
        self.assertEqual(action(cleaner,job,'withdraw').returncode,0)
        self.error(rpc('bloom_assigned_job_detail',dict(p_job=job),False,cleaner,'authenticated'),'NOT_FOUND')
        before=scalar(f"select role||':'||approved_city_id from public.users where id='{cid}';")
        self.error(rpc('bloom_provision_display_name',dict(p_subject=cleaner,p_display_name='Synthetic Cleaner'),False,cleaner,'authenticated'),'permission denied')
        updated=data(rpc('bloom_provision_display_name',dict(p_subject=cleaner,p_display_name='Synthetic Cleaner')))
        self.assertEqual(updated['displayName'],'Synthetic Cleaner')
        self.assertEqual(scalar(f"select role||':'||approved_city_id from public.users where id='{cid}';"),before)
        self.error(rpc('bloom_provision_display_name',dict(p_subject='unmapped',p_display_name='Synthetic'),False),'NOT_FOUND')
    def test_validation_and_review_only_events_are_not_silently_scheduled(self):
        actor,prop,sid,_=source();lease=begin(actor,sid)
        invalid=[snapshot([event(start='infinity')]),snapshot([event(start='2030-02-30')]),snapshot([event(),event()]),snapshot([event(kind='invented')]),snapshot([event(uid='x'*1025)]),{**snapshot([]),'coverage':{'from':'2030-01-01'}},snapshot([event(reviewRequired='false')]),{**snapshot([]),'issues':[{'code':'EVENT_REVIEW_REQUIRED'}]}]
        for snap in invalid:self.error(finish(actor,lease,snap,ok=False),'VALIDATION_ERROR')
        self.assertEqual(data(finish(actor,lease,snapshot([event(kind='unknown',evidence='unverified',reviewRequired=True)])))['status'],'success')
        self.assertEqual(scalar(f"select count(*) from public.calendar_events where source_id='{sid}';"),'1')
        self.assertEqual(scalar(f"select count(*) from public.jobs where property_id='{prop}';"),'0')

if __name__=='__main__':unittest.main(verbosity=2)
