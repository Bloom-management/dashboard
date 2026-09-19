"""Owner-created listing, replay and setup guard on disposable local PostgreSQL."""
import concurrent.futures
import json
import unittest
import uuid
from test_database import sql,scalar,make_user,action,CITY
from test_calendar_database import source,sync,event

class OwnerCreation(unittest.TestCase):
 def setUp(self):
  self.owner,self.oid=make_user('owner');self.other,_=make_user('owner');self.admin,self.aid=make_user('admin');self.cleaner,self.cid=make_user()
  self.body=dict(name='LOCAL TEST owner creation',address='Synthetic address',cityId=CITY,timezone='America/Detroit',bedroomCount=2,bathroomCount=1)
 def create(self,key='create',body=None,subject=None):
  return sql("select bloom_owner_listing_create('"+json.dumps(body or self.body)+"'::jsonb,'"+key+"');",subject or self.owner,ok=False)
 def test_atomic_concurrent_replay_actor_scope_and_strict_inputs(self):
  with concurrent.futures.ThreadPoolExecutor(2) as pool:r=list(pool.map(lambda _:self.create(),range(2)))
  self.assertTrue(all(x.returncode==0 for x in r),[x.stderr for x in r]);self.assertEqual(r[0].stdout,r[1].stdout)
  listing=json.loads(r[0].stdout)['listing'];pid=listing['id'];self.assertTrue(listing['setupRequired']);self.assertEqual(listing['bedroomCount'],2)
  self.assertEqual(scalar(f"select count(*) from property_owners where property_id='{pid}' and owner_id='{self.oid}';"),'1')
  self.assertEqual(scalar(f"select solo_rate_cents||':'||owner_created||':'||active from properties where id='{pid}';"),'7500:true:true')
  self.assertEqual(scalar(f"select count(*) from properties where id='{pid}';",self.other),'0')
  self.assertEqual(json.loads(scalar('select bloom_owner_listings(null);',self.owner))['items'][0],{**listing,'maintenance':[]})
  self.assertIn('CONFLICT',self.create(body={**self.body,'name':'changed'}).stderr)
  for subject in [self.admin,self.cleaner]:self.assertIn('FORBIDDEN',self.create(subject=subject).stderr)
  for extra in [dict(ownerId=self.oid),dict(soloRateCents=1),dict(isBloomOwned=True),dict(bedroomCount=21),dict(bathroomCount=1.5),dict(timezone='Invalid/Zone'),dict(name='')]:
   self.assertIn('VALIDATION_ERROR',self.create(key=str(uuid.uuid4()),body={**self.body,**extra}).stderr)
 def test_imported_jobs_hidden_and_unclaimable_until_actual_configuration(self):
  pid=json.loads(self.create().stdout)['listing']['id'];_,_,sid,_=source(actor=self.aid,prop=pid)
  sync(self.aid,sid,[event()]);jid=scalar(f"select id from jobs where property_id='{pid}';")
  self.assertEqual(scalar(f"select setup_required||':'||review_required from jobs where id='{jid}';"),'true:false')
  self.assertNotEqual(sql(f"select id from jobs where id='{jid}';",self.cleaner,ok=False).returncode,0)
  # Existing grants already deny raw jobs; exercise the restrictive policy with an isolated ID-only grant.
  sql('grant select(id) on public.jobs to authenticated;')
  try:self.assertEqual(scalar(f"select count(id) from jobs where id='{jid}';",self.cleaner),'0')
  finally:sql('revoke select(id) on public.jobs from authenticated;')
  self.assertNotIn(jid,scalar("select bloom_jobs('2030-05-01','2030-05-10');",self.cleaner))
  self.assertIn('REVIEW_REQUIRED',action(self.cleaner,jid,'claim').stderr)
  self.assertIn('REVIEW_REQUIRED',action(self.admin,jid,'claim').stderr)
  rooms=[dict(id=str(uuid.uuid4()),type=x,label=x,requiredPhoto=True) for x in ['kitchen','living_room']]
  config=dict(version=0,rooms=rooms,supplies=[])
  # A separate calendar hold must survive setup being completed.
  sql(f"update jobs set review_required=true where id='{jid}';")
  result=sql(f"select bloom_cleaning_config('{pid}','{json.dumps(config)}'::jsonb,'configure');",self.admin,ok=False);self.assertEqual(result.returncode,0,result.stderr)
  self.assertEqual(scalar(f"select setup_required||':'||review_required||':'||(cleaning_config is not null) from jobs where id='{jid}';"),'false:true:true')
  self.assertIn('REVIEW_REQUIRED',action(self.cleaner,jid,'claim').stderr)
  # Explicit admin resolution is independent from property configuration.
  version=scalar(f"select version from jobs where id='{jid}';")
  resolved=action(self.admin,jid,'keep',extra=f",{version},'{{\"reason\":\"Synthetic resolved hold\"}}'")
  self.assertEqual(resolved.returncode,0,resolved.stderr)
  self.assertEqual(action(self.cleaner,jid,'claim').returncode,0)
  listing=json.loads(scalar('select bloom_owner_listings(null);',self.owner))['items'][0];self.assertFalse(listing['setupRequired'])
 def test_configuration_claim_race_never_assigns_without_configuration(self):
  pid=json.loads(self.create().stdout)['listing']['id'];_,_,sid,_=source(actor=self.aid,prop=pid);sync(self.aid,sid,[event()]);jid=scalar(f"select id from jobs where property_id='{pid}';")
  rooms=[dict(id=str(uuid.uuid4()),type=x,label=x,requiredPhoto=True) for x in ['kitchen','living_room']]
  config=json.dumps(dict(version=0,rooms=rooms,supplies=[]))
  with concurrent.futures.ThreadPoolExecutor(2) as pool:
   configured=pool.submit(sql,f"select bloom_cleaning_config('{pid}','{config}','configure');",self.admin)
   claimed=pool.submit(action,self.cleaner,jid,'claim')
   a,b=configured.result(),claimed.result()
  self.assertEqual(a.returncode,0,a.stderr)
  if b.returncode:self.assertIn('REVIEW_REQUIRED',b.stderr)
  self.assertEqual(scalar(f"select setup_required||':'||(cleaning_config is not null) from jobs where id='{jid}';"),'false:true')
  if b.returncode:self.assertEqual(action(self.cleaner,jid,'claim').returncode,0)
  self.assertEqual(scalar(f"select count(*) from assignments where job_id='{jid}' and ended_at is null;"),'1')
 def test_deleted_listing_stays_hidden_and_old_properties_are_not_retroactively_held(self):
  pid=json.loads(self.create().stdout)['listing']['id'];scalar(f"select bloom_property_delete('{pid}','delete');",self.owner)
  self.assertEqual(json.loads(scalar('select bloom_owner_listings(null);',self.owner))['items'],[])
  _,prop,sid,_=source(actor=self.aid);sync(self.aid,sid,[event()])
  self.assertEqual(scalar(f"select setup_required from jobs where property_id='{prop}';"),'f')

if __name__=='__main__':unittest.main(verbosity=2)
