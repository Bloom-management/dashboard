"""Disposable database authorization/lifecycle tests; no real listings are deleted."""
import concurrent.futures
import json
import unittest
import uuid
from test_database import sql,scalar,make_user,make_job,action
from test_calendar_database import source,sync,event,begin,finish as finish_sync,snapshot
from test_cleaner_journey import fixture,photos,finish

class ListingDeletionTests(unittest.TestCase):
 def setUp(self):
  self.admin,self.aid=make_user('admin');self.owner,self.oid=make_user('owner');self.other,_=make_user('owner');self.cleaner,_=make_user()
  self.job,self.pid=make_job();sql(f"insert into property_owners values('{self.pid}','{self.oid}');")
 def delete(self,sub,key=None,pid=None):
  return sql(f"select bloom_property_delete('{pid or self.pid}','{key or uuid.uuid4().hex}');",sub,ok=False)
 def test_scope_replay_and_read_removal(self):
  for sub,code in [(self.other,'NOT_FOUND'),(self.cleaner,'FORBIDDEN')]:self.assertIn(code,self.delete(sub).stderr)
  self.assertNotEqual(sql(f"select bloom_property_delete('{self.pid}','anon');",'anon','anon',False).returncode,0)
  first=self.delete(self.owner,'delete');self.assertEqual(first.returncode,0,first.stderr)
  self.assertEqual(self.delete(self.owner,'delete').stdout,first.stdout)
  self.assertEqual(scalar(f"select status from jobs where id='{self.job}';"),'cancelled')
  self.assertEqual(scalar(f"select count(*) from properties where id='{self.pid}';",self.owner),'0')
  self.assertEqual(json.loads(scalar("select bloom_owner_listings();",self.owner))['items'],[])
  self.assertEqual(json.loads(scalar(f"select bloom_admin_property_options('{self.pid}');",self.admin))['items'],[])
  self.assertIn('NOT_FOUND',sql(f"select bloom_owner_analytics(current_date,current_date+10,array['{self.pid}']::uuid[]);",self.owner,ok=False).stderr)
  self.assertEqual(scalar(f"select count(*) from private.listing_deletions where property_id='{self.pid}';"),'1')
  sql(f"delete from property_owners where property_id='{self.pid}';")
  self.assertIn('NOT_FOUND',self.delete(self.owner,'delete').stderr)
 def test_assignment_blocks_and_race_preserves_assigned_job(self):
  with concurrent.futures.ThreadPoolExecutor(2) as pool:
   claim=pool.submit(action,self.admin,self.job,'claim');delete=pool.submit(self.delete,self.owner)
   c,d=claim.result(),delete.result()
  self.assertTrue(c.returncode==0 or d.returncode==0,(c.stderr,d.stderr))
  self.assertFalse(c.returncode==0 and d.returncode==0)
  if c.returncode==0:
   self.assertIn('CONFLICT',d.stderr);self.assertEqual(scalar(f"select deleted_at is null from properties where id='{self.pid}';"),'t')
   self.assertIn('CONFLICT',self.delete(self.admin).stderr)
  else:self.assertEqual(scalar(f"select count(*) from assignments where job_id='{self.job}' and ended_at is null;"),'0')
 def test_source_fencing_calendar_hidden_and_no_revival(self):
  actor,_,sid,_=source(self.aid,self.pid);sync(actor,sid,[event()]);lease=begin(actor,sid)
  self.assertEqual(self.delete(self.admin).returncode,0)
  self.assertEqual(scalar(f"select enabled from calendar_sources where id='{sid}';"),'f')
  self.assertIn('CONFLICT',finish_sync(actor,lease,snapshot([event()]),ok=False).stderr)
  self.assertEqual(json.loads(scalar("select bloom_owner_calendar('2030-05-01','2030-05-30');",self.owner)),[])
  self.assertIn('NOT_FOUND',sql(f"update properties set active=true where id='{self.pid}';",ok=False).stderr)
  self.assertIn('NOT_FOUND',sql(f"update calendar_sources set enabled=true where id='{sid}';",ok=False).stderr)
  self.assertIn('NOT_FOUND',sql(f"update jobs set status='open' where id='{self.job}';",ok=False).stderr)
 def test_completed_history_unchanged(self):
  admin,a,_,_,job,pid,c,body=fixture();photos(a,job,c);self.assertEqual(finish(a,job,body).returncode,0)
  before=scalar(f"select private.job_snapshot('{job}');")
  self.assertEqual(self.delete(admin,pid=pid).returncode,0)
  self.assertEqual(scalar(f"select private.job_snapshot('{job}');"),before)
  self.assertEqual(scalar(f"select count(*) from job_supply_reports where job_id='{job}';"),'1')

if __name__=='__main__':unittest.main(verbosity=2)
