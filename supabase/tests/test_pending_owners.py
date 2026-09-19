"""Pending ownership permission and atomic provisioning against disposable PostgreSQL."""
import concurrent.futures
import json
import unittest
import uuid
from test_database import sql,scalar,make_user,CITY
from test_calendar_database import rpc,data

class PendingOwners(unittest.TestCase):
 def setUp(self):
  self.admin,self.aid=make_user('admin');self.email=uuid.uuid4().hex+'@example.invalid'
  self.body=dict(cityId=CITY,name='LOCAL TEST pending owner',timezone='America/Detroit',address='Synthetic location',instructions='Synthetic instructions',isBloomOwned=False,soloRateCents=7500,ownerIds=[],pendingOwnerEmail=self.email)
 def create(self,body=None,key=None):
  return sql("select public.bloom_admin_property('"+json.dumps(body or self.body)+"'::jsonb,'"+(key or uuid.uuid4().hex)+"');",self.admin,ok=False)
 def claim(self,subject=None,email=None,role='service_role'):
  return rpc('bloom_claim_pending_owner',dict(p_subject=subject or 'pending_'+self.email,p_email=email or self.email,p_display_name='LOCAL TEST Owner'),role=role,ok=False)
 def test_claim_is_atomic_idempotent_and_isolated(self):
  pid=data(self.create())['id'];pid2=data(self.create())['id']
  self.assertEqual(scalar(f"select count(*) from public.property_owners where property_id='{pid}';"),'0')
  opts=json.loads(scalar(f"select bloom_admin_property_options('{pid}',null);",self.admin));self.assertEqual(opts['items'][0]['pendingOwnerEmail'],self.email)
  with concurrent.futures.ThreadPoolExecutor(2) as pool: results=list(pool.map(lambda _:self.claim(),range(2)))
  self.assertTrue(all(r.returncode==0 for r in results),[r.stderr for r in results]);u=data(results[0]);self.assertEqual(data(results[1]),u);self.assertEqual(u['role'],'owner')
  self.assertEqual(scalar(f"select count(*) from public.property_owners where owner_id='{u['id']}';"),'2')
  sub='pending_'+self.email;other,_=make_user('owner')
  self.assertEqual(scalar(f"select count(*) from public.properties where id in ('{pid}','{pid2}');",sub),'2')
  self.assertEqual(scalar(f"select count(*) from public.properties where id='{pid}';",other),'0')
  self.assertNotEqual(sql('select * from private.pending_property_owners;',sub,ok=False).returncode,0)
  opts=json.loads(scalar(f"select bloom_admin_property_options('{pid}',null);",self.admin));self.assertIsNone(opts['items'][0]['pendingOwnerEmail'])
 def test_no_preapproval_no_promotion_or_client_execution(self):
  self.assertEqual(self.claim().stdout.strip(),'')
  self.create();cleaner,cid=make_user()
  self.assertIn('CONFLICT',self.claim(subject=cleaner).stderr)
  self.assertEqual(scalar(f"select role from users where id='{cid}';"),'cleaner')
  for role in ('authenticated','anon'):
   self.assertNotEqual(self.claim(role=role).returncode,0)
  self.assertEqual(self.claim(email='different@example.invalid').stdout.strip(),'')
 def test_validation_and_setup_replay(self):
  first=self.create(key='pending');self.assertEqual(first.returncode,0,first.stderr);self.assertEqual(first.stdout,self.create(key='pending').stdout)
  owner,oid=make_user('owner')
  for b in (dict(self.body,isBloomOwned=True),dict(self.body,ownerIds=[oid]),dict(self.body,pendingOwnerEmail='bad'),dict(self.body,pendingOwnerEmail=4)):
   self.assertIn('VALIDATION_ERROR',self.create(b).stderr)
  self.assertEqual(data(self.claim(email=self.email.upper()))['role'],'owner')

if __name__=='__main__':unittest.main()
