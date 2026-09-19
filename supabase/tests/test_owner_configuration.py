"""Owner configuration authorization, counts, snapshots and replay."""
import json,unittest,uuid
from test_database import sql,scalar,make_user,CITY,action
from test_calendar_database import source,sync,event

class OwnerConfiguration(unittest.TestCase):
 def setUp(self):
  self.owner,self.oid=make_user('owner');self.other,_=make_user('owner');self.admin,self.aid=make_user('admin');self.cleaner,_=make_user()
  body=dict(name='LOCAL TEST owner configuration',address='TEST ONLY',cityId=CITY,timezone='America/Detroit',bedroomCount=1,bathroomCount=1)
  self.pid=json.loads(scalar("select bloom_owner_listing_create('"+json.dumps(body)+"','new');",self.owner))['listing']['id']
  self.config=dict(version=0,rooms=[dict(id=str(uuid.uuid4()),type=t,label='TEST '+t,requiredPhoto=True) for t in ['bedrooms','bathrooms','kitchen','living_room']],supplies=[dict(id=str(uuid.uuid4()),name='TEST soap')])
 def save(self,subject=None,config=None,key='save'):
  return sql("select bloom_cleaning_config('"+self.pid+"','"+json.dumps(config or self.config)+"','"+key+"');",subject or self.owner,ok=False)
 def test_owner_save_counts_release_and_stable_snapshot(self):
  _,_,sid,_=source(actor=self.aid,prop=self.pid);sync(self.aid,sid,[event()]);jid=scalar(f"select id from jobs where property_id='{self.pid}';")
  self.assertEqual(scalar(f"select setup_required from jobs where id='{jid}';"),'t')
  a=self.save();self.assertEqual(a.returncode,0,a.stderr);self.assertEqual(self.save().stdout,a.stdout)
  self.assertEqual(scalar(f"select bedroom_count||':'||bathroom_count from properties where id='{self.pid}';"),'1:1')
  self.assertEqual(scalar(f"select setup_required from jobs where id='{jid}';"),'f')
  snapshot=scalar(f"select cleaning_config from jobs where id='{jid}';")
  changed={**self.config,'version':1,'rooms':self.config['rooms']+[dict(id=str(uuid.uuid4()),type='bedrooms',label='TEST second',requiredPhoto=True)]}
  self.assertEqual(self.save(config=changed,key='change').returncode,0)
  self.assertEqual(scalar(f"select bedroom_count from properties where id='{self.pid}';"),'2')
  self.assertEqual(scalar(f"select cleaning_config from jobs where id='{jid}';"),snapshot)
  self.assertIn('CONFLICT',self.save(key='stale').stderr)
 def test_isolation_revocation_and_fields(self):
  self.assertIn('NOT_FOUND',self.save(subject=self.other).stderr)
  self.assertIn('FORBIDDEN',self.save(subject=self.cleaner).stderr)
  for extra in [dict(ownerId=self.oid),dict(soloRateCents=1),dict(version=-1)]:self.assertIn('VALIDATION_ERROR',self.save(config={**self.config,**extra}).stderr)
  self.assertEqual(self.save().returncode,0)
  sql(f"delete from property_owners where property_id='{self.pid}' and owner_id='{self.oid}';")
  self.assertIn('NOT_FOUND',self.save().stderr)
  self.assertEqual(sql(f"select bloom_cleaning_config('{self.pid}');",self.admin,ok=False).returncode,0)

if __name__=='__main__':unittest.main(verbosity=2)
