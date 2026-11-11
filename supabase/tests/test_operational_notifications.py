"""Disposable PostgreSQL; simulated verified claims, no provider requests or hosted writes."""
import json, unittest, uuid
from test_database import sql, scalar, make_user, make_job, CITY
from test_calendar_database import source, sync, event
from test_private_teams import Teams

class Operations(unittest.TestCase):
 def setUp(self):
  sql("truncate private.push_deliveries,private.push_messages,private.push_publications,private.push_device_accounts,private.push_devices,private.push_preferences,private.notification_events,private.opportunity_notifications;update private.push_control set activated_at=null,last_tick_at=null;")
 def events(self,user,kind=None):
  condition=f"and kind='{kind}'" if kind else ''
  return json.loads(scalar(f"select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'job',job_id,'data',payload,'content',private.notification_content(id,now(),false))),'[]') from private.notification_events where user_id='{user}' {condition};"))
 def decline(self,job,subject,comment='Cannot attend',key=None,ok=True):
  return sql(f"select public.bloom_decline_job('{job}','{comment}','{key or uuid.uuid4()}');",subject,ok=ok)
 def enable(self,uid):
  sql(f"select public.bloom_push_device('{uuid.uuid4().hex*2}','{uid}','session','preferences','{{\"pushEnabled\":true}}');")
 def test_selected_private_defaults_decline_comment_and_retry(self):
  _,admin=make_user('admin');subject,owner,prop,job,cleaners=Teams().fixture()
  self.assertEqual(scalar(f"select count(*) from assignments where job_id='{job}' and ended_at is null;"),'2')
  self.assertEqual(len(self.events(cleaners[0][1],'assigned')),1)
  self.assertEqual(len(self.events(cleaners[2][1],'assigned')),0)
  self.assertNotEqual(self.decline(job,cleaners[0][0],'',ok=False).returncode,0)
  self.decline(job,cleaners[0][0],key='one');self.decline(job,cleaners[0][0],key='one')
  sql(f"update jobs set setup_required=true where id='{job}';update jobs set setup_required=false where id='{job}';")
  self.assertEqual(scalar(f"select count(*) from assignments where job_id='{job}' and cleaner_id='{cleaners[0][1]}';"),'1')
  self.assertEqual(scalar(f"select count(*) from assignments where job_id='{job}' and ended_at is null;"),'1')
  owner_notice=self.events(owner,'withdrawn')[0]['content']['body'];self.assertIn('Cannot attend',owner_notice);self.assertIn('replacement',owner_notice);self.assertIn('1 of 2',owner_notice)
  teammate=self.events(cleaners[1][1],'withdrawn')[0]['content']['body'];self.assertIn('$90',teammate);self.assertIn('solo',teammate)
  _,stranger=make_user('owner');self.assertEqual(self.events(stranger),[]);self.assertEqual([e for e in self.events(admin) if e['job']==job],[])
  sql(f"delete from property_owners where property_id='{prop}' and owner_id='{owner}';");self.assertIsNone(self.events(owner,'withdrawn')[0]['content'])
 def test_withdrawal_does_not_replay_after_explicit_owner_reassignment(self):
  subject,owner,prop,job,cleaners=Teams().fixture();self.decline(job,cleaners[0][0])
  self.assertIsNotNone(self.events(owner,'withdrawn')[0]['content'])
  payload=json.dumps({'cleanerId':cleaners[0][1]})
  sql(f"select public.bloom_private_job_action('{job}','assign','{payload}','explicit-reassign');",subject)
  self.assertIsNone(self.events(owner,'withdrawn')[0]['content']);self.assertIsNone(self.events(cleaners[1][1],'withdrawn')[0]['content'])
 def test_explicit_private_pay_is_preserved(self):
  subject,owner,prop,job,cleaners=Teams().fixture(explicit=True)
  self.decline(job,cleaners[0][0]);self.assertIn('$45',self.events(cleaners[1][1],'withdrawn')[0]['content']['body'])
  self.assertEqual(scalar(f"select agreed_pay_cents from assignments where job_id='{job}' and ended_at is null;"),'4500')
 def test_unclaimed_three_and_one_days_only_zero_cleaners_and_batching(self):
  _,uid=make_user();_,other=make_user();_,optout=make_user();sql(f"update users set bloom_network_enabled=false where id='{optout}';")
  day=scalar("select (now() at time zone 'America/Detroit')::date;")
  jobs=[make_job(day=f"date '{day}'+{offset}")[0] for offset in [1,3,1,1,1,2]]
  sql(f"insert into assignments(job_id,cleaner_id,slot) values('{jobs[2]}','{other}',1);update jobs set review_required=true where id='{jobs[3]}';update jobs set status='cancelled' where id='{jobs[4]}';")
  sql('select public.bloom_push_activate();')
  sql(f"select public.bloom_push_tick((date '{day}'+time '08:10') at time zone 'America/Detroit');select public.bloom_push_tick((date '{day}'+time '08:20') at time zone 'America/Detroit');")
  notices=self.events(uid,'unclaimed');self.assertEqual(len(notices),1);self.assertEqual(set(notices[0]['data']['jobs']),set(jobs[:2]));self.assertIn('2 cleanings',notices[0]['content']['body']);self.assertEqual(self.events(optout,'unclaimed'),[])
  sql(f"insert into assignments(job_id,cleaner_id,slot) values('{jobs[0]}','{uid}',1);")
  current=self.events(uid,'unclaimed')[0]['content'];self.assertNotIn('2 cleanings',current['body'])
 def same_day_job(self,admin=None):
  zone=scalar("select name from pg_timezone_names where extract(hour from now() at time zone name) between 8 and 12 order by name limit 1;")
  prop=scalar(f"insert into properties(city_id,name,address,timezone) values('{CITY}','Same-day unit','Fixture','{zone}') returning id;")
  job=scalar(f"insert into jobs(property_id,checkout_date,start_at,end_at,timezone_snapshot,solo_rate_cents_snapshot) select '{prop}',d,(d+time '11:00') at time zone '{zone}',(d+time '15:00') at time zone '{zone}','{zone}',7500 from(select (now() at time zone '{zone}')::date d)x returning id;")
  return job,prop
 def test_same_day_escalates_and_deduplicates(self):
  admin,aid=make_user('admin');subject,uid=make_user();job,prop=self.same_day_job()
  self.assertEqual(len([x for x in self.events(aid,'coverage') if x['job']==job]),1)
  self.assertEqual(len([x for x in self.events(uid,'available') if job in x['data']['jobs']]),1)
  sql('select public.bloom_push_activate();select public.bloom_push_tick();select public.bloom_push_tick();')
  self.assertEqual(len([x for x in self.events(uid,'available') if job in x['data']['jobs']]),1)
  sql(f"insert into assignments(job_id,cleaner_id,slot) values('{job}','{uid}',1);")
  self.assertIsNone([x for x in self.events(uid,'available') if job in x['data']['jobs']][0]['content'])
  sql(f"update assignments set ended_at=now(),end_reason='withdrawn',withdrawal_comment='Unable' where job_id='{job}';")
  self.assertEqual(len([x for x in self.events(aid,'coverage') if x['job']==job]),2)
 def test_extension_retains_identity_and_assignments_then_allows_comment_decline(self):
  actor,prop,sid,_=source();sync(actor,sid,[event()]);job=scalar(f"select id from jobs where property_id='{prop}';");subject,uid=make_user()
  sql(f"insert into assignments(job_id,cleaner_id,slot) values('{job}','{uid}',1);")
  sync(actor,sid,[event(end='2030-05-05')]);sync(actor,sid,[event(end='2030-05-05')])
  self.assertEqual(scalar(f"select count(*) from jobs where property_id='{prop}';"),'1');self.assertEqual(scalar(f"select checkout_date from jobs where id='{job}';"),'2030-05-05')
  self.assertEqual(scalar(f"select count(*) from assignments where job_id='{job}' and ended_at is null;"),'1')
  self.assertEqual(len(self.events(uid,'extended')),1);body=self.events(uid,'extended')[0]['content']['body'];self.assertIn('May 3',body);self.assertIn('May 5',body)
  self.assertTrue(json.loads(scalar("select public.bloom_jobs('2030-05-05','2030-05-05');",subject))[0]['canDecline'])
  self.assertNotEqual(self.decline(job,subject,'',ok=False).returncode,0);self.decline(job,subject)
  sync(actor,sid,[event(end='2030-05-05')]);self.assertEqual(scalar(f"select count(*) from assignments where job_id='{job}' and ended_at is null;"),'0')
  self.assertIsNone(self.events(uid,'extended')[0]['content'])
 def test_started_and_ambiguous_stays_are_not_moved(self):
  actor,prop,sid,_=source();sync(actor,sid,[event()]);job=scalar(f"select id from jobs where property_id='{prop}';")
  sql(f"update jobs set started_at=start_at where id='{job}';");sync(actor,sid,[event(end='2030-05-05')])
  self.assertEqual(scalar(f"select checkout_date from jobs where id='{job}';"),'2030-05-03');self.assertEqual(scalar(f"select count(*) from jobs where property_id='{prop}';"),'1')
  self.assertEqual(scalar(f"select review_required from jobs where id='{job}';"),'t')
 def test_confirmed_payment_and_adjustment_have_distinct_copy(self):
  admin,aid=make_user('admin');subject,uid=make_user();job,prop=make_job(day='current_date-1')
  assignment=scalar(f"insert into assignments(job_id,cleaner_id,slot,completed_pay_cents) values('{job}','{uid}',1,7500) returning id;")
  sql(f"update jobs set status='completed',completed_at=now(),completed_by='{uid}' where id='{job}';")
  self.assertEqual(self.events(uid,'payment'),[])
  payload=json.dumps({'amountCents':7500,'method':'Cash','paymentDate':scalar('select current_date;'),'allocations':[{'cleaningId':assignment,'amountCents':7500}]})
  sql(f"select public.bloom_admin_payout_action('{uid}','payment','{payload}','pay-one');",admin)
  sql(f"select public.bloom_admin_payout_action('{uid}','payment','{payload}','pay-one');",admin)
  self.assertEqual(len(self.events(uid,'payment')),1);self.assertEqual(self.events(uid,'payment')[0]['content']['body'],'Bloom sent you $75.')
  sql(f"insert into private.payout_adjustments(assignment_id,amount_cents,reason,entered_by) values('{assignment}',1000,'Correction','{aid}');")
  adjusted=self.events(uid,'adjustment')[0]['content']['body'];self.assertIn('$10',adjusted);self.assertNotIn('sent',adjusted)
  inbox=json.loads(scalar('select public.bloom_notification_inbox();',subject));self.assertTrue(any(x['body']=='Bloom sent you $75.' for x in inbox['items']))
 def test_private_import_assigns_only_defaults_and_does_not_reassign_declines(self):
  subject,owner,prop,existing,cleaners=Teams().fixture();actor,_,sid,_=source(prop=prop)
  sync(actor,sid,[event()]);job=scalar(f"select id from jobs where property_id='{prop}' and checkout_date='2030-05-03';")
  self.assertEqual(scalar(f"select count(*) from assignments where job_id='{job}' and ended_at is null;"),'2')
  self.decline(job,cleaners[0][0]);sync(actor,sid,[event()]);sync(actor,sid,[event()])
  self.assertEqual(scalar(f"select count(*) from assignments where job_id='{job}' and cleaner_id='{cleaners[0][1]}';"),'1')
  self.assertEqual(scalar(f"select count(*) from assignments where job_id='{job}' and ended_at is null;"),'1')
 def test_changed_job_decline_bypasses_normal_cutoff_only_with_comment(self):
  subject,uid=make_user();job,prop=self.same_day_job()
  sql(f"insert into assignments(job_id,cleaner_id,slot) values('{job}','{uid}',1);update jobs set guest_extension_revision=1 where id='{job}';")
  self.assertEqual(scalar(f"select private.withdrawal_allowed(now(),start_at) from jobs where id='{job}';"),'f')
  self.assertNotEqual(sql(f"select public.bloom_job_action('{job}','withdraw','normal');",subject,ok=False).returncode,0)
  self.assertNotEqual(self.decline(job,subject,'',ok=False).returncode,0);self.decline(job,subject)
  self.assertEqual(scalar(f"select count(*) from assignments where job_id='{job}' and ended_at is null;"),'0')
 def test_owner_payment_uses_the_payer_name(self):
  subject,owner,prop,job,cleaners=Teams().fixture();sql(f"update users set display_name='Morgan' where id='{owner}';")
  Teams().complete(job,cleaners[0][0]);assignment=scalar(f"select id from assignments where job_id='{job}' and cleaner_id='{cleaners[0][1]}';")
  payload=json.dumps({'amountCents':4500,'method':'Cash','paymentDate':scalar('select current_date;'),'allocations':[{'cleaningId':assignment,'amountCents':4500}]})
  sql(f"select public.bloom_owner_payout_action('{cleaners[0][1]}','payment','{payload}','owner-pay');",subject)
  self.assertEqual(self.events(cleaners[0][1],'payment')[0]['content']['body'],'Morgan sent you $45.')
  self.assertEqual(len(self.events(cleaners[1][1],'completed')),1);self.assertEqual(self.events(cleaners[0][1],'completed'),[])
 def test_admin_participant_gets_one_event_and_no_own_claim_confirmation(self):
  admin,aid=make_user('admin');cleaner,cid=make_user();job,prop=make_job()
  sql(f"select public.bloom_job_action('{job}','claim','admin-claim');",admin)
  self.assertEqual([x for x in self.events(aid) if x['job']==job],[])
  sql(f"select public.bloom_job_action('{job}','claim','other-claim');",cleaner)
  notices=[x for x in self.events(aid) if x['job']==job];self.assertEqual(len(notices),1);self.assertEqual(notices[0]['kind'],'joined')
 def test_manual_reservation_extension_retains_job_and_selected_defaults(self):
  from test_manual_calendar import fixture,reviewed,result
  subject,owner,prop,cleaners=fixture(True)
  created=result(subject,prop,'create_booking',reviewed(subject,prop,{'checkIn':'2032-06-01','checkout':'2032-06-03'}));self.assertTrue(created['ok'])
  booking=created['bookingId'];job=created['jobId'];version=scalar(f"select version from private.manual_bookings where id='{booking}';")
  data={'bookingId':booking,'bookingVersion':int(version),'checkIn':'2032-06-01','checkout':'2032-06-05','reason':'Guest extended','confirmAssignments':True}
  changed=result(subject,prop,'edit_booking',reviewed(subject,prop,data));self.assertTrue(changed['ok'],changed)
  self.assertEqual(scalar(f"select count(*) from jobs where manual_booking_id='{booking}';"),'1');self.assertEqual(scalar(f"select checkout_date from jobs where id='{job}';"),'2032-06-05')
  self.assertEqual(scalar(f"select count(*) from assignments where job_id='{job}' and ended_at is null;"),'2')
  self.assertEqual(len(self.events(cleaners[0][1],'extended')),1)
 def test_unchanged_report_episodes_notify_once_then_reopen_after_resolution(self):
  subject,owner=make_user('owner');admin,aid=make_user('admin');reporter,cid=make_user();supply=str(uuid.uuid4())
  config=json.dumps({'version':1,'rooms':[],'supplies':[{'id':supply,'name':'Soap'}]})
  prop=scalar(f"insert into properties(city_id,name,address,cleaning_config) values('{CITY}','Report unit','Fixture','{config}') returning id;")
  sql(f"insert into property_owners values('{prop}','{owner}');")
  for i,level in enumerate(['low','low','full','low']):
   job=scalar(f"insert into jobs(property_id,checkout_date,start_at,end_at,timezone_snapshot,solo_rate_cents_snapshot) select '{prop}',d,(d+time '11:00') at time zone 'America/Detroit',(d+time '15:00') at time zone 'America/Detroit','America/Detroit',7500 from(select current_date-10+{i} d)x returning id;")
   sql(f"insert into public.job_supply_reports(job_id,supply_id,name,level,reported_by,reported_at) values('{job}','{supply}','Soap','{level}','{cid}',now());update jobs set status='completed',completed_at=now(),completed_by='{cid}' where id='{job}';")
   count=2 if i==3 else 1
   self.assertEqual(len(self.events(owner,'report')),count);self.assertEqual(len([e for e in self.events(aid,'report') if e['job'] in [x['job'] for x in self.events(owner,'report')]]),count)

 def test_payout_reminder_is_a_scheduled_summary_not_completion_side_effect(self):
  admin,aid=make_user('admin');cleaner,cid=make_user();job,prop=make_job(day='current_date-1')
  sql(f"insert into assignments(job_id,cleaner_id,slot,completed_pay_cents) values('{job}','{cid}',1,7500);update jobs set status='completed',completed_at=now(),completed_by='{cid}' where id='{job}';")
  self.assertEqual(self.events(aid,'payouts'),[])
  monday=scalar("select ((date_trunc('week',now() at time zone 'America/Detroit')+interval '7 days')::date+time '09:10') at time zone 'America/Detroit';")
  sql(f"select public.bloom_push_tick('{monday}');select public.bloom_push_tick('{monday}');")
  self.assertEqual(len(self.events(aid,'payouts')),1);self.assertIn('Payments due:',self.events(aid,'payouts')[0]['content']['body'])
 def test_ambiguous_blocked_change_never_becomes_a_stay_extension(self):
  actor,prop,sid,_=source();sync(actor,sid,[event()]);job=scalar(f"select id from jobs where property_id='{prop}';")
  subject,cid=make_user();sql(f"insert into assignments(job_id,cleaner_id,slot) values('{job}','{cid}',1);")
  sync(actor,sid,[event(end='2030-05-05',kind='blocked',evidence='unverified',reviewRequired=True)])
  self.assertEqual(scalar(f"select checkout_date from jobs where id='{job}';"),'2030-05-03');self.assertEqual(self.events(cid,'extended'),[])
  self.assertEqual(scalar(f"select count(*) from jobs where property_id='{prop}';"),'1')

 def test_new_preferences_preserved_and_service_boundary(self):
  _,uid=make_user();device=uuid.uuid4().hex*2
  def prefs(patch):return json.loads(scalar(f"select public.bloom_push_device('{device}','{uid}','session','preferences','{json.dumps(patch)}');"))
  self.assertTrue(prefs({'pushEnabled':True})['teammates']);prefs({'pushEnabled':False,'teammates':False});self.assertFalse(prefs({'pushEnabled':True})['teammates'])
  self.assertNotEqual(sql('select * from private.notification_events;','forged',ok=False).returncode,0)

if __name__=='__main__':unittest.main(verbosity=2)
