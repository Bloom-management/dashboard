"""Disposable SQL/JWT-claim fixtures, not live Clerk/PostgREST acceptance."""
import concurrent.futures
import json
import unittest
import uuid
from test_database import sql,scalar,make_user,make_job
from test_calendar_database import source,event,sync

class PropertyRenameTests(unittest.TestCase):
 def setUp(self):
  self.admin,self.aid=make_user('admin');self.owner,self.oid=make_user('owner')
  self.other,_=make_user('owner');self.cleaner,_=make_user()
  self.job,self.pid=make_job(day="date '2030-05-03'")
  sql(f"insert into public.property_owners values('{self.pid}','{self.oid}');")
 def rename(self,sub,name='Renamed unit',key=None,pid=None,role='authenticated'):
  value='null' if name is None else "'"+name.replace("'","''")+"'"
  return sql(f"select bloom_property_rename('{pid or self.pid}',{value},'{key or uuid.uuid4().hex}');",sub,role,False)
 def test_authorization_direct_mutation_and_revoked_receipt(self):
  self.assertEqual(self.rename(self.admin).returncode,0)
  self.assertEqual(self.rename(self.owner,key='replay').returncode,0)
  for sub,code in [(self.cleaner,'FORBIDDEN'),(self.other,'NOT_FOUND'),('unmapped','UNAUTHENTICATED')]:
   self.assertIn(code,self.rename(sub).stderr)
  self.assertIn('permission denied',self.rename('anonymous',role='anon').stderr)
  self.assertNotEqual(sql(f"update properties set name='bypass' where id='{self.pid}';",self.owner,ok=False).returncode,0)
  sql(f"delete from property_owners where property_id='{self.pid}';")
  self.assertIn('NOT_FOUND',self.rename(self.owner,key='replay').stderr)
 def test_validation_replay_and_concurrent_duplicate(self):
  for name in [None,'',' \t\n ','x'*201]:self.assertIn('VALIDATION_ERROR',self.rename(self.owner,name).stderr)
  with concurrent.futures.ThreadPoolExecutor(2) as pool:
   results=list(pool.map(lambda _:self.rename(self.owner,'  New unit  ','same'),range(2)))
  self.assertTrue(all(r.returncode==0 for r in results),[r.stderr for r in results])
  self.assertEqual(results[0].stdout,results[1].stdout)
  self.assertEqual(json.loads(results[0].stdout),{'id':self.pid,'name':'New unit'})
  self.assertIn('CONFLICT',self.rename(self.owner,'Different','same').stderr)
 def test_only_name_changes_and_shared_projection(self):
  actor,_,sid,_=source(self.aid,self.pid);sync(actor,sid,[event()])
  before=scalar(f"select to_jsonb(p)-'name' from properties p where id='{self.pid}';")
  self.assertEqual(self.rename(self.owner,'Shared label').returncode,0)
  self.assertEqual(before,scalar(f"select to_jsonb(p)-'name' from properties p where id='{self.pid}';"))
  options=json.loads(scalar(f"select bloom_admin_property_options('{self.pid}',null);",self.admin))
  self.assertEqual(options['items'][0]['name'],'Shared label')
  blocks=json.loads(scalar("select bloom_owner_calendar('2030-05-01','2030-05-30');",self.owner))
  self.assertEqual(blocks[0]['propertyName'],'Shared label')
  jobs=json.loads(scalar("select bloom_jobs('2030-05-01','2030-05-30');",self.cleaner))
  self.assertEqual(next(j for j in jobs if j['id']==self.job)['propertyName'],'Shared label')

if __name__=='__main__':unittest.main(verbosity=2)
