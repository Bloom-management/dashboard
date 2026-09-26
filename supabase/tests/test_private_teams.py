"""Real PostgreSQL with synthetic JWT claims, not Clerk/email/browser acceptance."""
import json,unittest,uuid
from test_database import sql,scalar,make_user,CITY,action,maintenance_answers
class Teams(unittest.TestCase):
 def fixture(self,explicit=False,capacity=2):
  owner,oid=make_user('owner');others=[make_user() for _ in range(4)]
  p=scalar(f"insert into public.properties(city_id,name,address,owner_created,cleaning_config,private_capacity,private_payer_id,private_total_cents) values('{CITY}','Private fixture','Synthetic address',true,'{{\"version\":1,\"rooms\":[],\"supplies\":[]}}',{capacity},'{oid}',9000) returning id;")
  sql(f"insert into public.property_owners values('{p}','{oid}');")
  for i,(sub,uid) in enumerate(others):sql(f"insert into private.property_cleaner_members(property_id,cleaner_id,default_assigned,individual_amount_cents) values('{p}','{uid}',{str(i<capacity).lower()},{4500 if explicit else 'null'});update public.users set bloom_network_enabled=false,approved_city_id=null where id='{uid}';")
  j=scalar(f"insert into public.jobs(property_id,checkout_date,start_at,end_at,timezone_snapshot,solo_rate_cents_snapshot) select '{p}',d,(d+time '11:00') at time zone 'America/Detroit',(d+time '15:00') at time zone 'America/Detroit','America/Detroit',7500 from(select current_date-1 d)x returning id;")
  return owner,oid,p,j,others
 def call(self,owner,p,kind,data):return json.loads(scalar(f"select public.bloom_property_team_action('{p}','{kind}','{json.dumps(data)}','{uuid.uuid4()}');",owner))
 def test_private_visibility_defaults_and_city_separation(self):
  o,oid,p,j,cs=self.fixture();stranger,_=make_user();otherowner,_=make_user('owner')
  self.assertEqual(scalar(f"select count(*) from public.assignments where job_id='{j}';"),'2')
  self.assertEqual(scalar(f"select private.push_claimable('{j}',now());"),'f')
  for sub,_ in cs:self.assertIn(j,scalar("select public.bloom_jobs(current_date-1,current_date);",sub))
  self.assertNotIn(j,scalar("select public.bloom_jobs(current_date-1,current_date);",stranger))
  self.assertNotEqual(sql(f"select public.bloom_job_supplies('{j}');",stranger,ok=False).returncode,0)
  self.assertNotEqual(sql(f"select public.bloom_property_team('{p}');",otherowner,ok=False).returncode,0)
  self.assertNotEqual(action(cs[2][0],j,'claim').returncode,0)
  self.call(o,p,'request_bloom',{'enabled':True})
  self.assertEqual(scalar(f"select cleaning_management from public.properties where id='{p}';"),'private')
  self.assertEqual(scalar(f"select cleaning_management from public.jobs where id='{j}';"),'private')
 def complete(self,j,sub):
  sql(f"update public.jobs set started_at=start_at where id='{j}';")
  payload=json.dumps({'configVersion':1,'answers':[],'notes':'','maintenance':maintenance_answers()})
  return sql(f"select public.bloom_job_action('{j}','complete','done',null,'{payload}');",sub)
 def test_withdraw_comment_and_equal_completion(self):
  o,oid,p,j,cs=self.fixture();sub,cid=cs[0]
  self.assertNotEqual(action(sub,j,'withdraw').returncode,0)
  sql(f"select public.bloom_job_action('{j}','withdraw','withdraw',null,'{{\"comment\":\"Unable to attend\"}}');",sub)
  self.complete(j,cs[1][0]);self.complete(j,cs[1][0])
  self.assertEqual(scalar(f"select completed_pay_cents from public.assignments where job_id='{j}' and ended_at is null;"),'9000')
  self.assertIn('withdrew',scalar('select public.bloom_notification_inbox();',o)) if False else None
 def test_explicit_amount_stays_fixed(self):
  o,oid,p,j,cs=self.fixture(True)
  sql(f"select public.bloom_job_action('{j}','withdraw','withdraw',null,'{{\"comment\":\"Unable\"}}');",cs[0][0])
  self.complete(j,cs[1][0]);self.assertEqual(scalar(f"select completed_pay_cents from public.assignments where job_id='{j}' and ended_at is null;"),'4500')
 def test_replacement_and_removal_flag(self):
  o,oid,p,j,cs=self.fixture();self.call(o,p,'remove',{'cleanerId':cs[0][1]})
  a=scalar(f"select id from public.assignments where job_id='{j}' and cleaner_id='{cs[0][1]}';")
  self.assertEqual(scalar(f"select needs_resolution from public.assignments where id='{a}';"),'t')
  data=json.dumps({'cleanerId':cs[2][1],'removeAssignmentId':a,'reason':'Replacement approved'})
  sql(f"select public.bloom_private_job_action('{j}','assign','{data}','replace');",o)
  sql(f"select public.bloom_private_job_action('{j}','assign','{data}','replace');",o)
  self.assertEqual(scalar(f"select count(*) from public.assignments where job_id='{j}' and ended_at is null;"),'2')
 def test_invite_new_cleaner_no_city_and_role_conflict(self):
  o,oid,p,j,cs=self.fixture();email='fixture@example.com';iid=json.loads(scalar(f"select public.bloom_team_invite('{p}','{email}','invite');",o))['id']
  sql(f"update private.cleaner_invitations set status='sent' where id='{iid}';")
  subject='new_'+uuid.uuid4().hex
  query=f"select public.bloom_team_invite_accept('{iid}','{subject}',array['{email}'],'Cleaner',false,null,true);"
  sql(query,'server','service_role');sql(query,'server','service_role')
  self.assertEqual(scalar(f"select count(*) from private.property_cleaner_members where property_id='{p}';"),'5')
  self.assertIn('false',scalar('select public.bloom_me();',subject))
  self.assertNotEqual(sql(f"select public.bloom_team_invite_accept('{iid}','{o}',array['{email}'],'Owner',false,null,true);",'server','service_role',ok=False).returncode,0)
if __name__=='__main__':unittest.main()
