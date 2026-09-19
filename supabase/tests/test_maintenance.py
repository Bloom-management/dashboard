import unittest,json
from test_database import sql,scalar,make_user
from test_cleaner_journey import fixture,photos,finish
class MaintenanceTests(unittest.TestCase):
 def test_required_atomic_report_replay_and_owner_projection(self):
  admin,actor,other,uid,job,prop,config,body=fixture();photos(actor,job,config)
  missing={k:v for k,v in body.items() if k!='maintenance'}
  self.assertIn('VALIDATION_ERROR',finish(actor,job,missing).stderr)
  bad={**body,'maintenance':[dict(category='water',status='attention',notes='')]*8}
  self.assertIn('VALIDATION_ERROR',finish(actor,job,bad).stderr)
  self.assertEqual(scalar(f"select count(*) from job_supply_reports where job_id='{job}';"),'0')
  self.assertEqual(scalar(f"select count(*) from job_maintenance_reports where job_id='{job}';"),'0')
  body['maintenance'][-1]={'category':'water','status':'attention','notes':'TEST dripping tap'}
  result=finish(actor,job,body,'done');self.assertEqual(result.returncode,0,result.stderr)
  receipt=json.loads(result.stdout)['receipt'];self.assertEqual(receipt['maintenance'][-1]['notes'],'TEST dripping tap')
  self.assertEqual(finish(actor,job,body,'done').stdout,result.stdout)
  self.assertEqual(scalar(f"select count(*) from job_maintenance_reports where job_id='{job}';"),'8')
  owner,oid=make_user('owner');foreign,_=make_user('owner');sql(f"insert into property_owners values('{prop}','{oid}');")
  listing=json.loads(scalar('select bloom_owner_listings(null);',owner))['items'][0]
  self.assertEqual(len(listing['maintenance']),8)
  self.assertEqual(set(listing['maintenance'][0]),{'category','status','notes','reportedAt'})
  self.assertEqual(json.loads(scalar('select bloom_owner_listings(null);',foreign))['items'],[])
  self.assertNotEqual(sql(f"update job_maintenance_reports set notes='change' where job_id='{job}';",actor,ok=False).returncode,0)
 def test_supply_preview_is_safe_and_city_scoped(self):
  admin,actor,other,uid,job,prop,config,body=fixture()
  preview=json.loads(scalar(f"select bloom_job_supplies('{job}');",actor));self.assertEqual(set(preview),{'supplies','reports'})
  self.assertEqual(preview['supplies'],config['supplies'])
  foreign,fid=make_user();sql(f"update users set approved_city_id=null where id='{fid}';")
  self.assertIn('NOT_FOUND',sql(f"select bloom_job_supplies('{job}');",foreign,ok=False).stderr)
  owner,_=make_user('owner');self.assertIn('FORBIDDEN',sql(f"select bloom_job_supplies('{job}');",owner,ok=False).stderr)
if __name__=='__main__':unittest.main(verbosity=2)
