"""Real PostgreSQL, synthetic subscription fixtures. No provider or browser enrollment proof."""
import hashlib,json,subprocess,unittest,uuid
from pathlib import Path
from test_database import sql,scalar,make_user,PSQL,PORT

def uid():return str(uuid.uuid4())
def read(query):return json.loads(scalar(f"select coalesce(({query}),'null'::jsonb);"))

class NativePush(unittest.TestCase):
 def setUp(self):
  sql('truncate private.push_device_accounts,private.push_deliveries,private.push_messages,private.push_publications,private.push_devices,private.push_preferences;update private.push_control set activated_at=null;')
  self.subject,self.user=make_user();self.other_subject,self.other=make_user('owner');self.device=uuid.uuid4().hex*2
  self.endpoint=uuid.uuid4().hex*2;self.fingerprint=uuid.uuid4().hex*2
  self.action('preferences',body={'pushEnabled':True})
 def action(self,action,user=None,body=None):
  return read(f"public.bloom_push_device('{self.device}','{user or self.user}','session','{action}','{json.dumps(body or {})}')")
 def start(self,user=None):
  nonce=uuid.uuid4().hex*2
  sql(f"update private.push_devices set enrollment_started=null where id='{self.device}';select public.bloom_push_enrollment('{self.device}','{user or self.user}','session','start','{nonce}');")
  return nonce
 def complete(self,nonce,user=None,session='session',ok=True):
  return sql(f"select public.bloom_push_enrollment('{self.device}','{user or self.user}','{session}','complete','{nonce}','{self.endpoint}','{self.fingerprint}','encrypted-fixture');",ok=ok)
 def enroll(self,user=None):self.complete(self.start(user),user)
 def delivery(self,user=None,state='pending'):
  message=scalar(f"insert into private.push_messages(logical_key,user_id,kind,expires_at) values(gen_random_uuid()::text,'{user or self.user}','test',now()+interval '1 hour') returning id;")
  delivery=scalar(f"insert into private.push_deliveries(message_id,device_id,generation,state) select '{message}',id,generation,'{state}' from private.push_devices where id='{self.device}' returning id;")
  return message,delivery
 def lease(self,delivery):return read(f"public.bloom_push_take(1,'{delivery}')")[0]
 def display(self,delivery,token=None,device=None):
  token_sql='null' if token is None else "'"+token+"'"
  return read(f"public.bloom_push_display('{delivery}','{device or self.device}',{token_sql})")
 def test_explicit_accounts_survive_logout_and_same_subscription_retry(self):
  self.enroll();generation=self.action('status')['transport'];self.assertEqual(generation,'native')
  before=scalar(f"select generation from private.push_devices where id='{self.device}';")
  self.assertFalse(self.action('status',self.other)['linked']);self.enroll(self.other)
  self.assertEqual(before,scalar(f"select generation from private.push_devices where id='{self.device}';"))
  sql(f"select public.bloom_push_device('{self.device}',null,null,'reconcile');")
  self.assertEqual(scalar('select count(*) from private.push_device_accounts where enabled;'),'2')
 def test_nonce_account_session_expiry_and_replay(self):
  nonce=self.start()
  self.assertNotEqual(self.complete(nonce,self.other,ok=False).returncode,0)
  self.assertNotEqual(self.complete(nonce,session='other-session',ok=False).returncode,0)
  sql(f"update private.push_devices set enrollment_expires=now()-interval '1 second';")
  self.assertNotEqual(self.complete(nonce,ok=False).returncode,0)
  nonce=self.start();self.complete(nonce);self.assertNotEqual(self.complete(nonce,ok=False).returncode,0)
 def test_enrollment_cannot_transfer_endpoint_or_expose_other_device_content(self):
  self.enroll();_,delivery=self.delivery(state='accepted');victim=self.device
  self.device=uuid.uuid4().hex*2;nonce=self.start(self.other)
  self.assertNotEqual(self.complete(nonce,self.other,ok=False).returncode,0)
  self.assertIsNone(self.display(delivery,'a'*64))
  self.assertEqual(scalar(f"select count(*) from private.push_device_accounts where device_id='{victim}';"),'1')
 def test_native_display_requires_received_secret_and_cookie_not_identifiers(self):
  self.enroll();_,delivery=self.delivery();row=self.lease(delivery);token=hashlib.sha256(b'received-secret').hexdigest()
  sql(f"select public.bloom_push_display_token('{delivery}','{row['lease']}','{token}');")
  self.assertIsNone(self.display(delivery));self.assertIsNone(self.display(delivery,'b'*64));self.assertIsNone(self.display(delivery,token,uuid.uuid4().hex*2))
  content=self.display(delivery,token);self.assertEqual(content['userId'],self.user);self.assertIsNone(content['nativeSubscription']);self.assertIsNone(content['subscription'])
  self.assertEqual(content['content']['body'],'Notifications are enabled on this device.')
  self.action('unlink');self.assertIsNone(self.display(delivery,token))
 def test_master_off_and_unlink_leave_other_account_and_inbox_independent(self):
  self.enroll();self.enroll(self.other);self.action('preferences',self.other,{'pushEnabled':True})
  _,first=self.delivery();_,second=self.delivery(self.other)
  self.action('preferences',body={'pushEnabled':False})
  self.assertEqual(read(f"public.bloom_push_take(1,'{first}')"),[])
  row=self.lease(second);self.assertEqual(read(f"public.bloom_push_delivery('{second}','{row['lease']}')")['userId'],self.other)
  self.assertTrue(self.action('status',self.other)['pushEnabled']);self.assertTrue(self.action('status')['linked'])
 def test_migration_preserves_unsent_identity_and_never_replays_accepted_or_ambiguous(self):
  sub=uid();sql(f"update private.push_devices set verified=true,subscription_id='{sub}' where id='{self.device}';")
  self.action('link');message,pending=self.delivery();accepted_message,accepted=self.delivery(state='accepted');_,ambiguous=self.delivery()
  row=self.lease(ambiguous);sql(f"select public.bloom_push_finish('{ambiguous}','{row['lease']}','pending');")
  self.enroll()
  self.assertEqual(scalar(f"select transport from private.push_deliveries where id='{pending}';"),'native')
  self.assertEqual(scalar(f"select state from private.push_deliveries where id='{accepted}';"),'accepted')
  self.assertEqual(scalar(f"select state from private.push_deliveries where id='{ambiguous}';"),'skipped')
  for m in [message,accepted_message]:sql(f"insert into private.push_deliveries(message_id,device_id,generation) select '{m}',id,generation from private.push_devices where id='{self.device}' on conflict do nothing;")
  self.assertEqual(scalar('select count(*) from private.push_deliveries;'),'3')
  sql(f"select public.bloom_push_rollback_device('{self.device}');")
  self.assertEqual(self.action('status')['transport'],'onesignal');self.assertEqual(scalar(f"select transport from private.push_deliveries where id='{pending}';"),'onesignal')
 def test_migration_refuses_inflight_send_and_native_only_rollback(self):
  self.enroll();_,delivery=self.delivery();self.lease(delivery)
  self.fingerprint=uuid.uuid4().hex*2
  self.assertNotEqual(self.complete(self.start(),ok=False).returncode,0)
  self.assertNotEqual(sql(f"select public.bloom_push_rollback_device('{self.device}');",ok=False).returncode,0)
 def test_invalid_subscription_marks_device_without_changing_preferences(self):
  self.enroll();_,delivery=self.delivery();row=self.lease(delivery)
  sql(f"select public.bloom_push_finish('{delivery}','{row['lease']}','failed',null,'SUBSCRIPTION_EXPIRED',true);")
  status=self.action('status');self.assertFalse(status['verified']);self.assertTrue(status['pushEnabled']);self.assertTrue(status['linked'])
 def test_transient_failure_preserves_registration_and_retry_identity(self):
  self.enroll();_,delivery=self.delivery();row=self.lease(delivery)
  sql(f"select public.bloom_push_finish('{delivery}','{row['lease']}','pending',null,'TRANSIENT');update private.push_deliveries set next_attempt=now() where id='{delivery}';")
  second=self.lease(delivery);self.assertEqual(second['id'],row['id']);self.assertEqual(second['attempts'],2);self.assertNotEqual(second['lease'],row['lease']);self.assertTrue(self.action('status')['verified'])
 def test_account_master_suppresses_two_native_devices_without_replay(self):
  self.enroll();first_device=self.device;self.delivery()
  self.device=uuid.uuid4().hex*2;self.endpoint=uuid.uuid4().hex*2;self.fingerprint=uuid.uuid4().hex*2;self.enroll();self.delivery()
  self.action('preferences',self.other,{'pushEnabled':True});self.device=first_device
  self.action('preferences',body={'pushEnabled':False});self.action('preferences',body={'pushEnabled':True})
  self.assertEqual(read('public.bloom_push_take(5)'),[]);self.assertEqual(scalar("select count(*) from private.push_deliveries where state='skipped';"),'2')
  self.assertTrue(self.action('status',self.other)['pushEnabled']);self.assertEqual(scalar("select count(*) from private.push_devices where transport='native' and verified;"),'2')
 def test_browser_roles_cannot_execute_enrollment_or_content_rpcs(self):
  for function in [f"bloom_push_enrollment('{self.device}','{self.user}','forged','start','{'a'*64}')",f"bloom_push_display('{uid()}','{self.device}','{'a'*64}')",f"bloom_push_rollback_device('{self.device}')"]:
   self.assertNotEqual(sql('select public.'+function+';',self.subject,ok=False).returncode,0)
 def test_pause_script_preserves_preferences_links_and_history(self):
  self.enroll();self.delivery(state='accepted');sql('select public.bloom_push_activate();')
  sql(Path('supabase/push/pause-delivery.sql').read_text())
  self.assertFalse(read('public.bloom_push_health()')['activated']);self.assertTrue(self.action('status')['pushEnabled']);self.assertTrue(self.action('status')['linked']);self.assertEqual(scalar("select count(*) from private.push_deliveries where state='accepted';"),'1')
 def test_https_schedule_refuses_production_origin_before_install_or_activation(self):
  result=subprocess.run([PSQL,'-h','127.0.0.1','-p',PORT,'-d','postgres','-X','-q','-v','bloom_test_origin=https://admin.bloomcleaning.org','-f','supabase/push/enable-test-schedule.sql'],capture_output=True,text=True)
  self.assertNotEqual(result.returncode,0);self.assertIn('Expected an isolated nonproduction HTTPS origin',result.stderr)
  self.assertFalse(read('public.bloom_push_health()')['activated']);self.assertEqual(scalar("select count(*) from pg_extension where extname in ('pg_cron','pg_net');"),'0')

if __name__=='__main__':unittest.main(verbosity=2)
