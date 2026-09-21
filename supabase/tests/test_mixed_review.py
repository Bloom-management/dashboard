from test_database import configure_completion_fixture
"""Real disposable PostgreSQL mixed-feed scheduling and safe administrative reads."""
import datetime
import json
import unittest
import uuid
from test_database import sql,scalar,make_user,action
from test_calendar_database import source,sync,event

def unknown(**kw): return event(kind='unknown',evidence='unverified',reviewRequired=True,**kw)
class MixedReview(unittest.TestCase):
 def test_mixed_snapshot_repeat_and_private_property_review(self):
  admin,aid=make_user('admin');actor,prop,sid,_=source(actor=aid)
  events=[event(),unknown(uid='private-unknown-uid',start='2030-06-01',end='2030-06-04')]
  self.assertEqual(sync(actor,sid,events)['created'],2)
  self.assertEqual(scalar(f"select count(*) from jobs where property_id='{prop}';"),'1')
  self.assertEqual(scalar(f"select review_required from jobs where property_id='{prop}';"),'f')
  history=scalar(f"select count(*) from calendar_event_history h join calendar_events e on e.id=h.event_id where e.source_id='{sid}';")
  self.assertEqual(sync(actor,sid,events)['unchanged'],2)
  self.assertEqual(scalar(f"select count(*) from jobs where property_id='{prop}';"),'1')
  self.assertEqual(scalar(f"select count(*) from calendar_event_history h join calendar_events e on e.id=h.event_id where e.source_id='{sid}';"),history)
  query=f"select bloom_admin_property_calendar_review('{prop}',null);"
  page=json.loads(scalar(query,admin));self.assertEqual(len(page['items']),1)
  self.assertEqual(set(page['items'][0]),{'id','sourceId','provider','startDate','endDate','kind','status','reviewRequired','missingReason'})
  self.assertNotIn('private-unknown-uid',json.dumps(page));self.assertIsNone(page['nextCursor'])
  for role in ('owner','cleaner'):
   subject,_=make_user(role);self.assertIn('FORBIDDEN',sql(query,subject,ok=False).stderr)
  self.assertNotEqual(sql(query,'anonymous','anon',ok=False).returncode,0)
  self.assertIn('NOT_FOUND',sql(f"select bloom_admin_property_calendar_review('{uuid.uuid4()}',null);",admin,ok=False).stderr)
  _,other,_,_=source(actor=aid);self.assertEqual(json.loads(scalar(f"select bloom_admin_property_calendar_review('{other}',null);",admin))['items'],[])
 def test_admin_owner_calendar_includes_normal_reservations_without_an_owner(self):
  admin,aid=make_user('admin');actor,prop,sid,_=source(actor=aid)
  sync(actor,sid,[event()])
  self.assertEqual(scalar(f"select count(*) from property_owners where property_id='{prop}';"),'0')
  self.assertEqual(json.loads(scalar(f"select bloom_admin_property_calendar_review('{prop}',null);",admin))['items'],[])
  query=f"select bloom_admin_property_calendar_events('{prop}',null);"
  page=json.loads(scalar(query,admin));self.assertEqual(len(page['items']),1)
  self.assertEqual(page['items'][0]['kind'],'reservation')
  self.assertNotIn('uid',page['items'][0]);self.assertNotIn('encrypted_url',json.dumps(page))
  for role in ('owner','cleaner'):
   subject,_=make_user(role);self.assertIn('FORBIDDEN',sql(query,subject,ok=False).stderr)
  sql(f"update properties set deleted_at=now() where id='{prop}';")
  self.assertIn('NOT_FOUND',sql(query,admin,ok=False).stderr)
 def test_blocked_vrbo_no_job_and_review_pagination(self):
  admin,aid=make_user('admin');actor,prop,sid,_=source(actor=aid,provider='vrbo')
  start=datetime.date(2031,1,1);events=[]
  for i in range(102):
   date=start+datetime.timedelta(days=i*3)
   events.append(event(uid=str(i),start=str(date),end=str(date+datetime.timedelta(days=1)),kind='blocked',evidence='observed-block',reviewRequired=True))
  sync(actor,sid,events);self.assertEqual(scalar(f"select count(*) from jobs where property_id='{prop}';"),'0')
  first=json.loads(scalar(f"select bloom_admin_property_calendar_review('{prop}',null);",admin));self.assertEqual(len(first['items']),100)
  last=json.loads(scalar(f"select bloom_admin_property_calendar_review('{prop}','{first['nextCursor']}');",admin));self.assertEqual(len(last['items']),2);self.assertIsNone(last['nextCursor'])
  self.assertEqual(len({x['id'] for x in first['items']+last['items']}),102)
 def test_claimed_reclassification_holds_without_replacement(self):
  actor,prop,sid,_=source();sync(actor,sid,[event()]);job=scalar(f"select id from jobs where property_id='{prop}';")
  cleaner,_=make_user();self.assertEqual(action(cleaner,job,'claim').returncode,0)
  assignments=scalar(f"select jsonb_agg(a) from assignments a where job_id='{job}';")
  sync(actor,sid,[unknown(end='2030-05-08'),event(uid='unrelated',start='2030-07-01',end='2030-07-03')])
  self.assertEqual(scalar(f"select checkout_date||':'||review_required from jobs where id='{job}';"),'2030-05-03:true')
  self.assertEqual(scalar(f"select count(*) from jobs where property_id='{prop}';"),'2')
  self.assertEqual(scalar(f"select jsonb_agg(a) from assignments a where job_id='{job}';"),assignments)
 def test_existing_unclaimed_hold_survives_repromotion_and_move(self):
  actor,prop,sid,_=source();sync(actor,sid,[event()]);job=scalar(f"select id from jobs where property_id='{prop}';")
  sync(actor,sid,[unknown()])
  self.assertEqual(scalar(f"select review_required from jobs where id='{job}';"),'t')
  links=scalar(f"select jsonb_agg(x) from job_events x where job_id='{job}';")
  sync(actor,sid,[event(end='2030-05-09')]);sync(actor,sid,[event(end='2030-05-09')])
  self.assertEqual(scalar(f"select checkout_date||':'||status||':'||review_required from jobs where id='{job}';"),'2030-05-03:open:true')
  self.assertEqual(scalar(f"select count(*) from jobs where property_id='{prop}';"),'1')
  self.assertEqual(scalar(f"select jsonb_agg(x) from job_events x where job_id='{job}';"),links)
 def test_completed_reclassification_keeps_job_and_payout(self):
  actor,prop,sid,_=source();sync(actor,sid,[event(start='2025-01-01',end='2025-01-03')]);job=scalar(f"select id from jobs where property_id='{prop}';")
  cleaner,cid=make_user();sql(f"insert into assignments(job_id,cleaner_id,slot) values('{job}','{cid}',1);")
  for cat in ['bedrooms','bathrooms','kitchen','living_room']:
   sql(f"insert into job_photos(job_id,uploader_id,category,object_path,state,bytes,mime) values('{job}','{cid}','{cat}','{job}/{cat}','ready',100,'image/png');")
  configure_completion_fixture(job)
  self.assertEqual(action(cleaner,job,'complete').returncode,0)
  before=scalar(f"select private.job_snapshot('{job}');")
  sync(actor,sid,[unknown(start='2025-01-01',end='2025-01-05')]);sync(actor,sid,[unknown(start='2025-01-01',end='2025-01-05')])
  self.assertEqual(scalar(f"select private.job_snapshot('{job}');"),before)
  self.assertEqual(scalar(f"select count(*) from jobs where property_id='{prop}';"),'1')

if __name__=='__main__':unittest.main(verbosity=2)
