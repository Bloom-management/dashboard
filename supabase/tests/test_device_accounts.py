"""Real local SQL, synthetic identities; no real browser permissions/provider delivery."""
import json,unittest,uuid
from test_database import sql,scalar,make_user,make_job
from test_push import call

class DeviceAccounts(unittest.TestCase):
 def setUp(self):
  sql('truncate private.push_device_accounts,private.push_deliveries,private.push_messages,private.push_publications,private.push_devices,private.push_preferences;update private.push_control set activated_at=null;')
  self.subject,self.user=make_user('cleaner');self.owner_subject,self.owner=make_user('owner');self.device=uuid.uuid4().hex*2;self.subscription=str(uuid.uuid4())
  self.action('challenge',body={'subscription':self.subscription,'hash':'a'*64})
  self.action('verify',body={'hash':'a'*64})
 def action(self,action,user=None,body=None,session='session'):
  return json.loads(call('device',f"'{self.device}','{user or self.user}','{session}','{action}','{json.dumps(body or {})}'"))
 def message(self,user):
  return scalar(f"insert into private.push_messages(logical_key,user_id,kind,expires_at) values(gen_random_uuid()::text,'{user}','test',now()+interval '1 hour') returning id;")
 def delivery(self,user):
  m=self.message(user)
  id=scalar(f"insert into private.push_deliveries(message_id,device_id,generation,state) select '{m}',id,generation,'accepted' from private.push_devices where id='{self.device}' returning id;")
  return id
 def read(self,id,device=None):return json.loads(call('delivery',f"'{id}',null,'{device or self.device}'"))
 def test_multiple_accounts_survive_switch_and_logout_with_correct_identity(self):
  status=self.action('status',user=self.owner,session='owner-session');self.assertTrue(status['verified']);self.assertFalse(status['linked']);self.action('link',user=self.owner)
  cleaner=self.delivery(self.user);owner=self.delivery(self.owner)
  for session in ['null',"'different-session'"]:
   call('device',f"'{self.device}',null,{session},'reconcile'")
   self.assertEqual(self.read(cleaner)['userId'],self.user)
   self.assertEqual(self.read(owner)['userId'],self.owner)
  self.assertIsNone(self.read(owner,uuid.uuid4().hex*2))
  self.assertEqual(scalar('select count(*) from private.push_device_accounts;'),'2')
  self.assertNotEqual(sql('select * from private.push_device_accounts;',self.subject,ok=False).returncode,0)
  self.assertNotEqual(sql(f"select public.bloom_push_device('{self.device}','{self.owner}','forged','status');",self.subject,ok=False).returncode,0)
 def test_stop_one_account_persists_and_device_disable_stops_every_account(self):
  self.action('link',user=self.owner);cleaner=self.delivery(self.user);owner=self.delivery(self.owner)
  self.action('unlink');self.action('status');self.assertFalse(self.action('status')['linked'])
  self.assertIsNone(self.read(cleaner));self.assertIsNotNone(self.read(owner))
  self.action('link');self.assertTrue(self.action('status')['linked']);self.assertIsNone(self.read(cleaner)) # no replay of old alerts
  self.assertIsNotNone(self.read(self.delivery(self.user)))
  call('device',f"'{self.device}',null,null,'detach'")
  self.assertIsNone(self.read(owner));self.assertFalse(self.action('status')['verified'])
 def test_one_device_can_receive_both_accounts_once_per_tick(self):
  # New-job notifications for two distinct eligible cleaners on one physical device.
  _,other=make_user('cleaner');self.action('link',user=other)
  for u in [self.user,other]:self.action('preferences',user=u,body={'newJobs':True,'reminders':True,'pushEnabled':True})
  call('activate','');make_job();call('tick','');call('tick','')
  self.assertEqual(scalar('select count(*) from private.push_deliveries;'),'2')
  self.assertEqual(scalar('select count(distinct device_id) from private.push_deliveries;'),'1')
 def test_unverified_device_cannot_link_and_challenge_cannot_switch_identity(self):
  self.action('disable')
  sql(f"update private.push_devices set last_test_at=null where id='{self.device}';")
  self.action('challenge',body={'subscription':self.subscription,'hash':'b'*64})
  for action,body in [('link',{}),('verify',{'hash':'b'*64})]:
   self.assertNotEqual(sql(f"select public.bloom_push_device('{self.device}','{self.owner}','other','{action}','{json.dumps(body)}');",ok=False).returncode,0)
  self.assertFalse(self.action('status',user=self.owner)['verified'])
  self.action('verify',body={'hash':'b'*64});self.assertTrue(self.action('status')['linked'])

if __name__=='__main__':unittest.main(verbosity=2)
