"""Real PostgreSQL with synthetic JWTs, not browser/provider delivery."""
import json,unittest,uuid
from test_database import sql,scalar,make_user,make_job
from test_calendar_database import source
class InboxTests(unittest.TestCase):
 def setUp(self):
  self.subject,self.user=make_user()
 def inbox(self,subject=None,offset=0):
  return json.loads(scalar(f'select public.bloom_notification_inbox({offset});',subject or self.subject))
 def message(self,job,kind='new'):
  return scalar(f"insert into private.push_messages(logical_key,user_id,kind,city_id,job_ids,job_date,cutoff,expires_at) select '{uuid.uuid4()}','{self.user}','{kind}',p.city_id,array[j.id],j.checkout_date,now(),now()-interval '1 minute' from public.jobs j join public.properties p on p.id=j.property_id where j.id='{job}' returning id;")
 def test_cleaner_dismissal_isolation_and_resolved_work(self):
  job,_=make_job();mid=self.message(job)
  self.assertEqual(self.inbox()['total'],1) # inbox outlives provider TTL
  other,_=make_user();self.assertEqual(self.inbox(other)['total'],0)
  self.assertNotEqual(sql(f"select public.bloom_notification_dismiss('push:{mid}');",other,ok=False).returncode,0)
  sql(f"select public.bloom_notification_dismiss('push:{mid}');",self.subject)
  self.assertEqual(self.inbox()['total'],0)
  job2,_=make_job();self.message(job2);self.assertEqual(self.inbox()['total'],1)
  sql(f"update public.jobs set status='cancelled' where id='{job2}';")
  self.assertEqual(self.inbox()['total'],0)
 def test_reminder_withdrawal_completion_and_pagination(self):
  job,_=make_job();sql(f"insert into public.assignments(job_id,cleaner_id,slot) values('{job}','{self.user}',1);")
  self.message(job,'morning');self.assertEqual(self.inbox()['total'],1)
  sql(f"update public.jobs set status='completed',completed_at=now(),completed_by='{self.user}' where id='{job}';")
  self.assertEqual(self.inbox()['total'],0)
  for _ in range(11):
   j,_=make_job();self.message(j)
  self.assertEqual(len(self.inbox()['items']),10);self.assertEqual(len(self.inbox(offset=10)['items']),1)
 def test_owner_isolation_sync_resolution_and_critical_not_dismissible(self):
  owner,oid=make_user('owner');other,_=make_user('owner');admin,aid=make_user('admin')
  _,prop,sid,_=source(actor=aid)
  sql(f"insert into public.property_owners values('{prop}','{oid}');update public.calendar_sources set last_error_code='SYNC_FAILED' where id='{sid}';")
  self.assertEqual(self.inbox(owner)['total'],1);self.assertEqual(self.inbox(other)['total'],0)
  self.assertNotEqual(sql(f"select public.bloom_notification_dismiss('sync:{sid}');",owner,ok=False).returncode,0)
  self.assertTrue(any(x['id']=='sync:'+sid for x in self.inbox(admin)['items']))
  sql(f"update public.calendar_sources set last_error_code=null where id='{sid}';")
  self.assertEqual(self.inbox(owner)['total'],0)
if __name__=='__main__':unittest.main()
