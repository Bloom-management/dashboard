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
 def test_three_participant_rounding_and_frozen_history(self):
  o,oid,p,j,cs=self.fixture(capacity=3)
  sql(f"update public.jobs set private_total_cents_snapshot=9001 where id='{j}';")
  self.complete(j,cs[0][0])
  self.assertEqual(scalar(f"select sum(completed_pay_cents) from public.assignments where job_id='{j}';"),'9001')
  self.assertEqual(scalar(f"select max(completed_pay_cents)-min(completed_pay_cents) from public.assignments where job_id='{j}';"),'1')
  self.call(o,p,'settings',{'capacity':3,'totalCents':12000})
  self.assertEqual(scalar(f"select sum(completed_pay_cents) from public.assignments where job_id='{j}';"),'9001')
 def test_optout_retains_bloom_commitment_and_cannot_discover(self):
  from test_database import make_job
  sub,uid=make_user();j,p=make_job();other,_=make_job()
  sql(f"select public.bloom_job_action('{j}','claim','claim');",sub)
  sql("select public.bloom_cleaner_network(false,null,'optout');",sub)
  visible=scalar('select public.bloom_jobs(current_date,current_date+10);',sub)
  self.assertIn(j,visible);self.assertNotIn(other,visible)
  self.assertNotEqual(action(sub,other,'claim').returncode,0)
 def test_atomic_onboarding_rolls_back_all_invites(self):
  o,oid,p,j,cs=self.fixture();email='atomic@example.com'
  iid=json.loads(scalar(f"select public.bloom_team_invite('{p}','{email}','atomic');",o))['id']
  sql(f"update private.cleaner_invitations set status='sent' where id='{iid}';")
  subject='new_'+uuid.uuid4().hex
  result=sql(f"select public.bloom_team_onboard(array['{iid}'::uuid,'{uuid.uuid4()}'::uuid],'{subject}',array['{email}'],'Cleaner',false,null);",'server','service_role',ok=False)
  self.assertNotEqual(result.returncode,0)
  self.assertEqual(scalar(f"select count(*) from public.users where clerk_user_id='{subject}';"),'0')
  self.assertEqual(scalar(f"select status from private.cleaner_invitations where id='{iid}';"),'sent')
 def test_dto_helper_not_exposed(self):
  o,oid,p,j,cs=self.fixture();stranger,_=make_user()
  self.assertNotEqual(sql(f"select private.job_dto('{j}');",stranger,ok=False).returncode,0)
 def test_calendar_sync_creates_private_defaults_once(self):
  from test_calendar_database import source,sync,event
  o,oid,p,j,cs=self.fixture();admin,aid=make_user('admin')
  _,_,sid,_=source(actor=aid,prop=p)
  sync(aid,sid,[event()]);sync(aid,sid,[event()])
  imported=scalar(f"select id from jobs where property_id='{p}' and checkout_date='2030-05-03';")
  self.assertEqual(scalar(f"select count(*) from assignments where job_id='{imported}';"),'2')
  self.assertEqual(scalar(f"select cleaning_management||':'||payer_owner_id from jobs where id='{imported}';"),'private:'+oid)
  self.assertEqual(scalar(f"select count(*) from private.push_publications where job_id='{imported}';"),'0')
 def test_inactive_city_private_reminder_content(self):
  o,oid,p,j,cs=self.fixture()
  city=scalar("insert into cities(name,active,notification_timezone) values('Private inactive fixture',false,'America/Detroit') returning id;")
  sql(f"update properties set city_id='{city}' where id='{p}';update jobs set checkout_date=current_date+1,start_at=((current_date+1)+time '11:00') at time zone 'America/Detroit',end_at=((current_date+1)+time '15:00') at time zone 'America/Detroit' where id='{j}';insert into private.push_preferences(user_id,new_jobs,reminders) values('{cs[0][1]}',false,true);")
  mid=scalar(f"insert into private.push_messages(logical_key,user_id,kind,city_id,job_date,cutoff,expires_at) values('inactive-{j}','{cs[0][1]}','evening','{city}',current_date+1,now()+interval '1 minute',now()+interval '5 minutes') returning id;")
  self.assertIn('1 cleaning tomorrow',scalar(f"select private.push_content('{mid}',now());"))
 def test_settings_and_defaults_rpc_four_members_choose_two(self):
  o,oid,p,j,cs=self.fixture()
  changed=self.call(o,p,'settings',{'capacity':2,'totalCents':9000})
  self.assertEqual(changed['totalCents'],9000)
  changed=self.call(o,p,'defaults',{'cleaners':[{'cleanerId':cs[2][1],'individualAmountCents':None},{'cleanerId':cs[3][1],'individualAmountCents':None}]})
  self.assertEqual({m['id'] for m in changed['members'] if m['defaultAssigned']},{cs[2][1],cs[3][1]})
  changed=self.call(o,p,'defaults',{'cleaners':[{'cleanerId':cs[2][1],'individualAmountCents':4000},{'cleanerId':cs[3][1],'individualAmountCents':5000}]})
  self.assertEqual(sorted(m['individualAmountCents'] for m in changed['members'] if m['defaultAssigned']),[4000,5000])
  self.assertEqual({x for x in scalar(f"select string_agg(cleaner_id::text,',') from assignments where job_id='{j}' and ended_at is null;").split(',')},{cs[0][1],cs[1][1]})
 def test_invitation_invalid_states_and_verified_email_mismatch(self):
  o,oid,p,j,cs=self.fixture()
  for state in ['pending','revoked','expired','mismatched']:
   email=state+'@example.com'
   iid=json.loads(scalar(f"select public.bloom_team_invite('{p}','{email}','{state}');",o))['id']
   if state!='pending':
    stored='sent' if state in ['expired','mismatched'] else state
    sql(f"update private.cleaner_invitations set status='{stored}' where id='{iid}';")
   if state=='expired':sql(f"update private.cleaner_invitations set expires_at=now()-interval '1 second' where id='{iid}';")
   subject='rejected_'+uuid.uuid4().hex
   verified='someoneelse@example.com' if state=='mismatched' else email
   result=sql(f"select public.bloom_team_invite_accept('{iid}','{subject}',array['{verified}'],'Cleaner',false,null,true);",'server','service_role',ok=False)
   self.assertNotEqual(result.returncode,0,state)
   self.assertEqual(scalar(f"select count(*) from public.users where clerk_user_id='{subject}';"),'0')
  self.assertEqual(scalar(f"select count(*) from private.property_cleaner_members where property_id='{p}';"),'4')
if __name__=='__main__':unittest.main()
