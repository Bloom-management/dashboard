"""Co-owner scope, acceptance, concurrency and delivery guards in disposable PostgreSQL."""
import concurrent.futures,json,unittest,uuid
from test_database import sql,scalar,make_user,CITY

class PropertyPeople(unittest.TestCase):
 def setUp(self):
  self.owner,self.oid=make_user('owner');self.other,self.otherid=make_user('owner');self.cleaner,_=make_user();self.admin,self.aid=make_user('admin')
  self.pid=scalar(f"insert into properties(city_id,name,address) values('{CITY}','TEST co-owner','TEST') returning id;")
  sql(f"insert into property_owners values('{self.pid}','{self.oid}');")
  self.email='coowner@example.com'
 def invite(self,key='invite',subject=None,email=None):
  return sql(f"select bloom_property_invite('{self.pid}','{email or self.email}','{key}');",subject or self.owner,ok=False)
 def service(self,query,ok=True):return sql(query,'server','service_role',ok)
 def sent(self):
  iid=json.loads(self.invite().stdout)['id'];lease=json.loads(self.service(f"select bloom_property_invite_delivery('{self.oid}','{iid}');").stdout)['lease']
  self.service(f"select bloom_property_invite_delivery('{self.oid}','{iid}','{lease}','synthetic-delivery');")
  return iid
 def accept(self,iid,subject=None,email=None):
  return self.service(f"select bloom_property_invite_accept('{iid}','{subject or self.other}',array['{email or self.email}'],'TEST co-owner');",False)
 def test_home_base_is_visible_only_to_property_members_and_admin(self):
  sql(f"update users set home_base='Chicago' where id='{self.oid}';")
  for subject in [self.owner,self.admin]:
   members=json.loads(scalar(f"select bloom_property_people('{self.pid}');",subject))['members']
   self.assertEqual(members[0]['location'],'Chicago')
  for subject in [self.other,self.cleaner]:
   self.assertIn('NOT_FOUND',sql(f"select bloom_property_people('{self.pid}');",subject,ok=False).stderr)
 def test_invitation_scope_replay_and_no_early_access(self):
  for subject in [self.other,self.cleaner]:self.assertIn('NOT_FOUND',self.invite(subject=subject).stderr)
  with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda _:self.invite(),range(2)))
  self.assertTrue(all(r.returncode==0 for r in results));self.assertEqual(results[0].stdout,results[1].stdout)
  self.assertIn('CONFLICT',self.invite(email='changed@example.com').stderr)
  self.assertEqual(scalar(f"select count(*) from property_owners where property_id='{self.pid}';"),'1')
  self.assertIn('NOT_FOUND',sql(f"select bloom_property_people('{self.pid}');",self.other,ok=False).stderr)
  self.assertIn('permission denied',sql('select * from private.property_invitations;',self.owner,ok=False).stderr)
  self.assertEqual(self.invite(key='admin',subject=self.admin).returncode,0)
 def test_accept_verified_email_exact_property_role_and_replay(self):
  iid=self.sent();self.assertIn('NOT_FOUND',self.accept(iid,email='wrong@example.com').stderr)
  for subject in [self.cleaner,self.admin]:self.assertIn('FORBIDDEN',self.accept(iid,subject).stderr)
  self.assertIn('permission denied',sql(f"select bloom_property_invite_accept('{iid}','{self.other}',array['{self.email}'],'TEST');",self.other,ok=False).stderr)
  with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda _:self.accept(iid),range(2)))
  self.assertTrue(all(r.returncode==0 for r in results),[r.stderr for r in results]);self.assertEqual(results[0].stdout,results[1].stdout)
  self.assertEqual(scalar(f"select count(*) from property_owners where owner_id='{self.otherid}';"),'1')
  self.assertEqual(len(json.loads(scalar(f"select bloom_property_people('{self.pid}');",self.other))['members']),2)
  self.assertEqual(scalar(f"select role from users where id='{self.otherid}';"),'owner')
  lease=scalar(f"select delivery_lease from private.property_invitations where id='{iid}';")
  self.service(f"select bloom_property_invite_delivery('{self.oid}','{iid}','{lease}','synthetic-delivery');")
  self.assertEqual(scalar(f"select status from private.property_invitations where id='{iid}';"),'accepted')
 def test_expired_removed_inviter_and_deleted_property_rejected(self):
  iid=self.sent();sql(f"update private.property_invitations set expires_at=now()-interval '1 day' where id='{iid}';")
  self.assertIn('INVALID_STATE',self.accept(iid).stderr)
  sql(f"update private.property_invitations set expires_at=now()+interval '1 day' where id='{iid}';delete from property_owners where property_id='{self.pid}';")
  self.assertIn('NOT_FOUND',self.accept(iid).stderr)
  sql(f"insert into property_owners values('{self.pid}','{self.oid}');update properties set deleted_at=now() where id='{self.pid}';")
  self.assertIn('NOT_FOUND',self.accept(iid).stderr)
 def test_unmapped_owner_provisioning_and_delivery_lease(self):
  iid=json.loads(self.invite().stdout)['id'];self.assertIn('INVALID_STATE',self.accept(iid).stderr)
  result=self.service(f"select bloom_property_invite_delivery('{self.oid}','{iid}');");lease=json.loads(result.stdout)['lease']
  self.assertIn('CONFLICT',self.service(f"select bloom_property_invite_delivery('{self.oid}','{iid}');",False).stderr)
  self.assertIn('CONFLICT',self.service(f"select bloom_property_invite_delivery('{self.oid}','{iid}','{uuid.uuid4()}','wrong');",False).stderr)
  self.service(f"select bloom_property_invite_delivery('{self.oid}','{iid}','{lease}','synthetic');")
  subject='new_owner_'+uuid.uuid4().hex;self.assertEqual(self.accept(iid,subject).returncode,0)
  self.assertEqual(scalar(f"select role from users where clerk_user_id='{subject}';"),'owner')
  self.assertEqual(scalar(f"select count(*) from property_owners po join users u on u.id=po.owner_id where u.clerk_user_id='{subject}' and po.property_id='{self.pid}';"),'1')
if __name__=='__main__':unittest.main(verbosity=2)
