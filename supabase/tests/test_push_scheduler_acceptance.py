"""Actual scheduler SQL in a disposable cluster. Synthetic proven-device fixtures are NOT enrollment or physical delivery evidence."""
import json,unittest,uuid
from test_database import sql,scalar,make_user,make_job

class SchedulerAcceptance(unittest.TestCase):
 def setUp(self):
  sql("truncate private.push_deliveries,private.push_messages,private.push_publications,private.push_device_accounts,private.push_devices,private.push_preferences,private.notification_events,private.opportunity_notifications;update private.push_control set activated_at=null,last_tick_at=null;")
  self.subject,self.user=make_user();self.device=uuid.uuid4().hex*2
  self.bound_fixture(self.user)
  self.day=scalar("select (now() at time zone 'America/Detroit')::date;")
  self.at=f"(date '{self.day}'+time '08:10') at time zone 'America/Detroit'"
 def bound_fixture(self,user):
  sql(f"insert into private.push_preferences(user_id,push_enabled,initialized,reminders) values('{user}',true,true,true);insert into private.push_devices(id,user_id,session_id,subscription_id,verified) values('{self.device}','{user}','fixture',gen_random_uuid(),true) on conflict(id) do nothing;insert into private.push_device_accounts(device_id,user_id) values('{self.device}','{user}');")
 def due(self,offset=1):return make_job(day=f"date '{self.day}'+{offset}")[0]
 def activate_and_tick(self):sql(f"select public.bloom_push_activate();select public.bloom_push_tick({self.at});")
 def events(self,user=None):return json.loads(scalar(f"select coalesce(jsonb_agg(id),'[]') from private.notification_events where user_id='{user or self.user}' and kind='unclaimed';"))
 def lease(self):return json.loads(scalar('select public.bloom_push_take(5);'))
 def content(self,row):return json.loads(scalar(f"select coalesce(public.bloom_push_delivery('{row['id']}','{row['lease']}'),'null'::jsonb);"))
 def test_due_three_and_one_days_batch_once(self):
  first=self.due(1);second=self.due(3);self.due(2);self.activate_and_tick();sql(f"select public.bloom_push_tick({self.at});")
  self.assertEqual(len(self.events()),1)
  event=self.events()[0];jobs=json.loads(scalar(f"select payload->'jobs' from private.notification_events where id='{event}';"));self.assertEqual(set(jobs),{first,second})
  rows=self.lease();self.assertEqual(len(rows),1);self.assertEqual(self.content(rows[0])['userId'],self.user);self.assertEqual(self.lease(),[])
 def test_expired_work_cannot_dispatch(self):
  self.due();self.activate_and_tick();sql("update private.push_messages set expires_at=now()-interval '1 second';")
  self.assertEqual(self.lease(),[]);self.assertEqual(scalar("select count(*) from private.push_deliveries where state='skipped';"),'1')
 def test_assignment_is_rechecked_after_queueing(self):
  job=self.due();self.activate_and_tick();row=self.lease()[0];_,other=make_user();sql(f"insert into assignments(job_id,cleaner_id,slot) values('{job}','{other}',1);")
  self.assertIsNone(self.content(row))
 def test_opt_in_and_category_are_rechecked(self):
  self.due();self.activate_and_tick();row=self.lease()[0]
  sql(f"update private.push_preferences set categories=categories||'{{\"unclaimed\":false}}' where user_id='{self.user}';");self.assertIsNone(self.content(row))
  sql(f"update private.push_preferences set categories=categories||'{{\"unclaimed\":true}}' where user_id='{self.user}';update users set bloom_network_enabled=false where id='{self.user}';");self.assertIsNone(self.content(row))
 def test_cancellation_is_rechecked(self):
  job=self.due();self.activate_and_tick();row=self.lease()[0];sql(f"update jobs set status='cancelled' where id='{job}';");self.assertIsNone(self.content(row))
 def test_no_late_catch_up(self):
  self.due();sql(f"select public.bloom_push_activate();select public.bloom_push_tick((date '{self.day}'+time '09:01') at time zone 'America/Detroit');")
  self.assertEqual(self.events(),[]);self.assertEqual(self.lease(),[])
 def test_two_accounts_one_device_master_off_isolated_and_inbox_remains(self):
  other_subject,other=make_user();self.bound_fixture(other);self.due();self.activate_and_tick()
  sql(f"select public.bloom_push_device('{self.device}','{self.user}','fixture','preferences','{{\"pushEnabled\":false}}');")
  rows=self.lease();self.assertEqual(len(rows),1);self.assertEqual(self.content(rows[0])['userId'],other)
  inbox=json.loads(scalar('select public.bloom_notification_inbox();',self.subject));self.assertGreater(inbox['total'],0)
 def test_inactive_delivery_does_not_queue_push(self):
  self.due();sql(f"select public.bloom_push_tick({self.at});");self.assertEqual(self.lease(),[])

if __name__=='__main__':unittest.main(verbosity=2)
