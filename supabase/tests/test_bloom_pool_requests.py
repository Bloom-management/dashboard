"""Real PostgreSQL authorization tests; JWT identities are synthetic."""
import concurrent.futures,json,unittest,uuid
from test_database import sql,scalar,make_user,make_job,action,CITY

class PoolRequests(unittest.TestCase):
 def private_cleaner(self):
  sub='pool_'+uuid.uuid4().hex
  uid=scalar(f"insert into users(clerk_user_id,role,display_name,bloom_network_enabled,onboarding_completed_at) values('{sub}','cleaner','Private cleaner',false,now()) returning id;")
  return sub,uid
 def request(self,sub,key=None):
  return json.loads(scalar(f"select bloom_cleaner_network(true,'{CITY}','{key or uuid.uuid4()}');",sub))
 def pending(self,uid):
  return scalar(f"select id from private.bloom_pool_requests where cleaner_id='{uid}' and status='pending';")
 def resolve(self,admin,rid,decision,key=None):
  return sql(f"select bloom_pool_resolve('{rid}','{decision}','{key or uuid.uuid4()}');",admin,ok=False)
 def test_pending_denies_public_claim_approval_enables_direct_claim(self):
  sub,uid=self.private_cleaner();admin,_=make_user('admin');job,_=make_job()
  result=self.request(sub);self.assertFalse(result['bloomNetworkEnabled']);self.assertEqual(result['bloomPoolStatus'],'pending')
  self.assertNotIn(job,scalar('select bloom_jobs(current_date,current_date+10);',sub))
  self.assertNotEqual(action(sub,job,'claim').returncode,0)
  rid=self.pending(uid)
  self.assertIn('bloom_pool',scalar('select bloom_admin_requests();',admin))
  self.assertNotEqual(self.resolve(sub,rid,'approved').returncode,0)
  self.assertNotEqual(sql('select bloom_admin_requests();',sub,ok=False).returncode,0)
  self.assertEqual(self.resolve(admin,rid,'approved','approve').returncode,0)
  self.assertEqual(self.resolve(admin,rid,'approved','approve').returncode,0)
  self.assertEqual(action(sub,job,'claim').returncode,0)
  other,_=make_job();self.assertEqual(action(sub,other,'claim').returncode,0)
  sql("select bloom_cleaner_network(false,null,'off');",sub)
  self.assertFalse(json.loads(scalar('select bloom_me();',sub))['bloomNetworkEnabled'])
  self.assertTrue(self.request(sub)['bloomNetworkEnabled'])
  self.assertEqual(scalar(f"select count(*) from private.bloom_pool_requests where cleaner_id='{uid}';"),'1')
 def test_duplicate_concurrent_pending_and_decline_preserves_private(self):
  sub,uid=self.private_cleaner();admin,_=make_user('admin');owner,oid=make_user('owner')
  prop=scalar(f"insert into properties(city_id,name,address,owner_created,private_payer_id,cleaning_config) values('{CITY}','Private','Fixture',true,'{oid}','{{\"version\":1,\"rooms\":[],\"supplies\":[]}}') returning id;")
  sql(f"insert into property_owners values('{prop}','{oid}');insert into private.property_cleaner_members(property_id,cleaner_id,default_assigned) values('{prop}','{uid}',true);")
  job=scalar(f"insert into jobs(property_id,checkout_date,start_at,end_at,timezone_snapshot,solo_rate_cents_snapshot) values('{prop}',current_date+3,((current_date+3)+time '11:00') at time zone 'America/Detroit',((current_date+3)+time '15:00') at time zone 'America/Detroit','America/Detroit',9000) returning id;")
  with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(lambda _:self.request(sub),range(4)))
  self.assertEqual(scalar(f"select count(*) from private.bloom_pool_requests where cleaner_id='{uid}' and status='pending';"),'1')
  self.assertEqual(self.resolve(admin,self.pending(uid),'rejected').returncode,0)
  self.assertEqual(json.loads(scalar('select bloom_me();',sub))['bloomPoolStatus'],'rejected')
  self.assertIn(job,scalar('select bloom_jobs(current_date,current_date+10);',sub))
  self.assertEqual(scalar(f"select count(*) from assignments where job_id='{job}' and cleaner_id='{uid}' and ended_at is null;"),'1')
  self.assertEqual(self.request(sub)['bloomPoolStatus'],'pending')
 def test_private_invitation_onboarding_optin_is_pending(self):
  from test_private_teams import Teams
  owner,oid,prop,job,cleaners=Teams().fixture()
  email='pool@example.com';rid=json.loads(scalar(f"select bloom_team_invite('{prop}','{email}','pool-invite');",owner))['id']
  sql(f"update private.cleaner_invitations set status='sent' where id='{rid}';")
  sub='pool_invited_'+uuid.uuid4().hex
  sql(f"select bloom_team_invite_accept('{rid}','{sub}',array['{email}'],'Invited cleaner',true,'{CITY}',true);",'server','service_role')
  me=json.loads(scalar('select bloom_me();',sub));self.assertFalse(me['bloomNetworkEnabled']);self.assertEqual(me['bloomPoolStatus'],'pending')
  self.assertIn(job,scalar('select bloom_jobs(current_date-1,current_date+1);',sub))
 def test_existing_authorized_cleaner_and_city_requests_unchanged(self):
  sub,uid=make_user();job,_=make_job();self.assertEqual(action(sub,job,'claim').returncode,0)
  sql("select bloom_cleaner_network(false,null,'off');",sub);self.assertTrue(self.request(sub)['bloomNetworkEnabled'])
  city=scalar("insert into cities(name,active) values('Other request city',true) returning id;")
  sql(f"select bloom_city_request('{city}','city');",sub)
  self.assertEqual(scalar(f"select approved_city_id from users where id='{uid}';"),CITY)
  admin,_=make_user('admin');self.assertIn('city_change',scalar('select bloom_admin_requests();',admin))
  self.assertEqual(scalar(f"select count(*) from private.bloom_pool_requests where cleaner_id='{uid}';"),'0')

if __name__=='__main__':unittest.main()
