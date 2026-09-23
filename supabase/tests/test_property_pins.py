"""Real local PostgreSQL, synthetic verified claims; no external geocoding."""
import json,unittest
from test_database import sql,scalar,make_user,make_job
class PinTests(unittest.TestCase):
 def test_admin_confirmation_and_coordinate_validation(self):
  admin,_=make_user('admin');cleaner,_=make_user();owner,_=make_user('owner');job,prop=make_job()
  for actor in [cleaner,owner]:
   self.assertNotEqual(sql(f"select public.bloom_property_pin('{prop}','{{\"latitude\":42,\"longitude\":-83,\"confirmed\":true}}');",actor,ok=False).returncode,0)
  for pin in ['{"latitude":91,"longitude":-83,"confirmed":true}','{"latitude":42,"longitude":181,"confirmed":true}','{"latitude":42,"longitude":-83,"confirmed":false}']:
   self.assertNotEqual(sql(f"select public.bloom_property_pin('{prop}','{pin}');",admin,ok=False).returncode,0)
  self.assertEqual(json.loads(scalar(f"select public.bloom_property_pin('{prop}','{{\"latitude\":42,\"longitude\":-83,\"confirmed\":true}}');",admin)),{'latitude':42,'longitude':-83})
 def test_day_city_and_assignment_authorization(self):
  admin,_=make_user('admin');cleaner,cid=make_user();owner,_=make_user('owner')
  day="date '2030-05-01'";j,p=make_job(day=day);missing,_=make_job(day=day)
  city=scalar("insert into public.cities(name) values('Pin other city') returning id;")
  foreign,fp=make_job(day=day,city=city);tomorrow,tp=make_job(day="date '2030-05-02'")
  for prop in [p,fp,tp]:sql(f"select public.bloom_property_pin('{prop}','{{\"latitude\":42,\"longitude\":-83,\"confirmed\":true}}');",admin)
  def ids():return {r['jobId'] for r in json.loads(scalar("select public.bloom_day_pins('2030-05-01');",cleaner))}
  self.assertEqual(ids(),{j})
  sql(f"insert into public.assignments(job_id,cleaner_id,slot) values('{foreign}','{cid}',1);")
  self.assertEqual(ids(),{j,foreign}) # same exception as the existing jobs endpoint
  self.assertNotEqual(sql("select public.bloom_day_pins('2030-05-01');",owner,ok=False).returncode,0)
  self.assertNotEqual(sql("select * from private.property_pins;",cleaner,ok=False).returncode,0)
if __name__=='__main__':unittest.main()
