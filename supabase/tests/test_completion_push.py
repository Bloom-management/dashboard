"""Real local PostgreSQL, simulated verified claims; no OneSignal delivery."""
import json,unittest,uuid
from test_database import sql,scalar,make_user,make_job,maintenance_answers
from test_push import call

class CompletionPush(unittest.TestCase):
 def setUp(self):
  sql("truncate private.push_deliveries,private.push_messages,private.push_publications,private.push_devices,private.push_preferences;update private.push_control set activated_at=null;")
 def bind(self,uid):
  device=uuid.uuid4().hex*2
  call('device',f"'{device}','{uid}','session','challenge','{json.dumps({'subscription':str(uuid.uuid4()),'hash':'a'*64})}'")
  call('device',f"'{device}','{uid}','session','verify','{{\"hash\":\"{'a'*64}\"}}'")
  return device
 def fixture(self):
  self.owner,self.oid=make_user('owner');self.admin,self.aid=make_user('admin');self.cleaner,self.cid=make_user();self.other,self.xid=make_user('owner')
  self.job,self.prop=make_job(day="current_date-1");sql(f"insert into property_owners values('{self.prop}','{self.oid}');insert into assignments(job_id,cleaner_id,slot) values('{self.job}','{self.cid}',1);")
  self.devices={u:self.bind(u) for u in [self.oid,self.aid,self.cid,self.xid]}
 def complete(self):
  sql(f"update jobs set started_at=start_at,cleaning_config='{{\"version\":1,\"rooms\":[],\"supplies\":[]}}' where id='{self.job}';")
  payload=json.dumps({'configVersion':1,'answers':[],'notes':'','maintenance':maintenance_answers()})
  sql(f"select bloom_job_action('{self.job}','complete','complete',null,'{payload}');",self.cleaner)
 def test_completion_queues_once_without_open_browser_and_scope_rechecked(self):
  self.fixture();call('activate','');self.complete();self.complete();call('tick','');call('tick','')
  self.assertEqual(scalar(f"select count(*) from private.push_messages where kind='completion' and job_ids=array['{self.job}'::uuid];"),'3')
  self.assertEqual(scalar("select count(*) from private.push_deliveries;"),'3')
  for uid,role in [(self.oid,'owner'),(self.aid,'admin'),(self.cid,'cleaner')]:
   content=json.loads(scalar(f"select private.push_content(id,now()) from private.push_messages where user_id='{uid}' and kind='completion';"))
   self.assertIn('/'+role+'?',content['url']);self.assertIn('Cleaning completed',content['body'])
  self.assertEqual(scalar(f"select count(*) from private.push_messages where user_id='{self.xid}';"),'0')
  sql(f"delete from property_owners where property_id='{self.prop}' and owner_id='{self.oid}';")
  self.assertEqual(scalar(f"select private.push_content(id,now()) is null from private.push_messages where user_id='{self.oid}';"),'t')
  self.assertNotEqual(sql('select bloom_push_health();',self.owner,ok=False).returncode,0)
 def test_disabled_preferences_and_no_historical_blast(self):
  self.fixture();self.complete();call('activate','');call('tick','');self.assertEqual(scalar("select count(*) from private.push_messages where kind='completion';"),'0')
 def test_completion_preference_and_device_revocation(self):
  self.fixture();call('activate','');self.complete()
  call('device',f"'{self.devices[self.oid]}','{self.oid}','session','preferences','{{\"newJobs\":false,\"reminders\":false,\"completions\":false}}'")
  call('tick','');self.assertEqual(scalar(f"select count(*) from private.push_deliveries d join private.push_messages m on m.id=d.message_id where m.user_id='{self.oid}';"),'0')
  rows=json.loads(call('take','5'));self.assertTrue(rows)
  row=rows[0];d=json.loads(call('delivery',f"'{row['id']}','{row['lease']}'"));self.assertIsNotNone(d)
  call('device',f"'{self.devices[d['userId']]}',null,null,'detach'")
  self.assertEqual(call('delivery',f"'{row['id']}','{row['lease']}'"),'null')

if __name__=='__main__':unittest.main()
