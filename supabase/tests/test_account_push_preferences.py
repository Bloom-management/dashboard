"""Disposable PostgreSQL tests; no provider calls or real browser permissions."""
import json, unittest, uuid
from test_database import sql, scalar, make_user, make_job
from test_push import call

class AccountPushPreferences(unittest.TestCase):
 def setUp(self):
  sql('truncate private.push_device_accounts,private.push_deliveries,private.push_messages,private.push_publications,private.push_devices,private.push_preferences;')
  _,self.cleaner=make_user();_,self.admin=make_user('admin')
  self.device=uuid.uuid4().hex*2
 def action(self,kind,user=None,body=None,device=None):
  return json.loads(call('device',f"'{device or self.device}','{user or self.cleaner}','session','{kind}','{json.dumps(body or {})}'"))
 def bind(self,user=None,device=None):
  self.action('challenge',user,{'subscription':str(uuid.uuid4()),'hash':'a'*64},device)
  self.action('verify',user,{'hash':'a'*64},device)
 def queued(self,user,device):
  message=scalar(f"insert into private.push_messages(logical_key,user_id,kind,expires_at) values(gen_random_uuid()::text,'{user}','test',now()+interval '1 hour') returning id;")
  return scalar(f"insert into private.push_deliveries(message_id,device_id,generation) select '{message}',id,generation from private.push_devices where id='{device}' returning id;")
 def dispatchable(self,id):
  lease=str(uuid.uuid4());sql(f"update private.push_deliveries set state='attempted',lease='{lease}',lease_until=now()+interval '1 minute' where id='{id}';")
  return json.loads(call('delivery',f"'{id}','{lease}'"))
 def test_first_enable_and_reenable_preserve_categories(self):
  self.assertFalse(self.action('status')['pushEnabled'])
  first=self.action('preferences',body={'pushEnabled':True});self.assertTrue(first['newJobs']);self.assertTrue(first['reminders']);self.assertTrue(first['completions'])
  self.action('preferences',body={'newJobs':False,'reminders':False,'completions':False,'pushEnabled':False})
  again=self.action('preferences',body={'pushEnabled':True});self.assertFalse(again['newJobs']);self.assertFalse(again['reminders']);self.assertFalse(again['completions'])
 def test_private_cleaner_not_enrolled(self):
  sql(f"update public.users set bloom_network_enabled=false where id='{self.cleaner}';")
  enabled=self.action('preferences',body={'pushEnabled':True});self.assertFalse(enabled['newJobs']);self.assertTrue(enabled['reminders'])
  self.assertEqual(scalar(f"select bloom_network_enabled from public.users where id='{self.cleaner}';"),'f')
 def test_two_accounts_two_devices_and_queued_suppression(self):
  second=uuid.uuid4().hex*2;self.bind();self.bind(device=second)
  status=self.action('status',self.admin);self.assertFalse(status['linked'])
  self.action('link',self.admin)
  for user in [self.cleaner,self.admin]:self.action('preferences',user,{'pushEnabled':True})
  cleaner=[self.queued(self.cleaner,d) for d in [self.device,second]];admin=self.queued(self.admin,self.device)
  for id in cleaner+[admin]:self.assertIsNotNone(self.dispatchable(id))
  self.action('preferences',body={'pushEnabled':False})
  self.assertEqual(scalar(f"select count(*) from private.push_deliveries where id in ('{cleaner[0]}','{cleaner[1]}') and state='skipped';"),'2')
  for id in cleaner:self.assertIsNone(self.dispatchable(id))
  self.assertIsNotNone(self.dispatchable(admin));self.assertTrue(self.action('status',self.admin)['pushEnabled'])
  self.action('reconcile');self.assertTrue(self.action('status')['linked'])
  self.action('unlink');self.assertTrue(self.action('status',self.admin)['linked']);self.assertTrue(self.action('status',device=second)['linked'])
 def test_unregistered_device_does_not_change_account_preference(self):
  self.action('preferences',body={'pushEnabled':True});status=self.action('status',device=uuid.uuid4().hex*2)
  self.assertTrue(status['pushEnabled']);self.assertFalse(status['verified']);self.assertFalse(status['linked'])
 def test_inbox_and_unread_survive_master_off(self):
  subject=scalar(f"select clerk_user_id from public.users where id='{self.cleaner}';")
  job,prop=make_job()
  sql(f"insert into private.push_messages(logical_key,user_id,kind,city_id,job_ids,expires_at) select gen_random_uuid()::text,'{self.cleaner}','new',city_id,array['{job}'::uuid],now()+interval '1 hour' from public.properties where id='{prop}';")
  before=json.loads(scalar('select public.bloom_notification_inbox();',subject))
  self.action('preferences',body={'pushEnabled':False})
  after=json.loads(scalar('select public.bloom_notification_inbox();',subject))
  self.assertGreater(before['total'],0);self.assertEqual(before,after)
 def test_reenable_never_dispatches_messages_generated_while_push_was_off(self):
  self.bind();self.action('preferences',body={'pushEnabled':True});self.action('preferences',body={'pushEnabled':False})
  stale=self.queued(self.cleaner,self.device)
  sql(f"update private.push_messages set created_at=now()-interval '1 second' where id=(select message_id from private.push_deliveries where id='{stale}');")
  self.action('preferences',body={'pushEnabled':True})
  self.assertIsNone(self.dispatchable(stale))
  fresh=self.queued(self.cleaner,self.device);self.assertIsNotNone(self.dispatchable(fresh))
 def test_expired_and_failed_challenges_are_cleared(self):
  self.action('challenge',body={'subscription':str(uuid.uuid4()),'hash':'a'*64})
  self.action('cancelChallenge',body={'hash':'b'*64});self.assertTrue(self.action('status')['pending'])
  self.action('cancelChallenge',body={'hash':'a'*64});self.assertFalse(self.action('status')['pending'])
  sql(f"update private.push_devices set challenge_hash='old',challenge_expires=now()-interval '1 minute' where id='{self.device}';")
  self.action('status');self.assertEqual(scalar(f"select challenge_hash is null from private.push_devices where id='{self.device}';"),'t')

if __name__=='__main__':unittest.main(verbosity=2)
