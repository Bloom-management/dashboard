"""Real disposable PostgreSQL. Verified JWT claims are simulated; no hosted writes."""
import concurrent.futures,json,unittest,uuid
from test_database import sql,scalar,make_user,CITY

def js(v):return "'"+json.dumps(v).replace("'","''")+"'::jsonb"
class RoomVisits(unittest.TestCase):
 def setUp(self):
  self.admin,self.aid=make_user('admin');self.owner,self.oid=make_user('owner');self.outsider,_=make_user('owner');self.cleaners=[make_user() for _ in range(3)]
  self.house=scalar(f"insert into houses(name,address,created_by) values('TEST Dearborn','Synthetic address','{self.aid}') returning id;")
  sql(f"insert into house_visit_pricing values('{self.house}',6500,2500,4500,2000,0);")
  self.rooms=[]
  for i in range(1,5):
   p=scalar(f"insert into properties(city_id,name,address,house_id,listing_type,room_identifier) values('{CITY}','TEST DH{i}','Synthetic address','{self.house}','room','DH{i}') returning id;")
   sql(f"insert into property_owners values('{p}','{self.oid}');insert into house_spaces(house_id,property_id,kind,label) values('{self.house}','{p}','bedroom','DH{i}');insert into property_entry_instructions(property_id,instructions,access_info) values('{p}','Instructions DH{i}','{{\"code\":\"PRIVATE-{i}\"}}');")
   self.rooms.append(p)
  for kind in ['bathroom','kitchen','living_room']:sql(f"insert into house_spaces(house_id,kind,label) values('{self.house}','{kind}','Shared {kind}');")
  self.day=scalar("select (now() at time zone 'America/Detroit')::date;")
 def attach(self,i,day=None,key=None):
  day=day or self.day;key=key or 'reservation-'+str(i)
  return scalar(f"select private.room_turnover_attach('{self.rooms[i]}','{day}',('{day}'::date+time '00:00') at time zone 'America/Detroit',('{day}'::date+time '23:59') at time zone 'America/Detroit',null,null,'{key}');")
 def claim(self,j,i=0,key=None):return sql(f"select bloom_job_action('{j}','claim','{key or uuid.uuid4()}');",self.cleaners[i][0],ok=False)
 def visit(self,j,sub=None):return json.loads(scalar(f"select bloom_room_visit('{j}');",sub or self.owner))
 def consent(self,j,proposal,accept=True,i=0,version=None,key=None):
  version=version or self.visit(j)['job']['version']
  return sql(f"select bloom_room_visit_action('{j}','{'accept' if accept else 'decline'}',{js({'proposalId':proposal})},{version},'{key or uuid.uuid4()}');",self.cleaners[i][0],ok=False)
 def test_grouping_and_one_to_four_pricing(self):
  for i in range(4):
   j=self.attach(i);v=self.visit(j)
   self.assertEqual(len(v['rooms']),i+1);self.assertEqual(v['job']['soloRateCents'],4500+i*2000);self.assertEqual(v['job']['sharedRateCents'],2250+i*1000)
   self.assertEqual(scalar(f"select host_charge_cents_snapshot from jobs where id='{j}';"),str(6500+i*2500))
   self.assertEqual(len(v['spaces']),i+4)
  self.assertEqual(scalar(f"select count(*) from jobs where house_id='{self.house}';"),'1')
  self.assertEqual(self.attach(3),j)
  self.assertEqual(v['job']['propertyName'],'TEST Dearborn · DH1 & DH2 & DH3 & DH4')
 def test_claim_retry_does_not_reissue_scope_offers(self):
  j=self.attach(0);self.claim(j,0);self.attach(1)
  r=self.claim(j,1,key='second-claim');self.assertEqual(r.returncode,0,r.stderr)
  count=scalar(f"select count(*) from private.visit_proposals where job_id='{j}';")
  notices=scalar(f"select count(*) from private.visit_notices where job_id='{j}';")
  self.assertEqual(self.claim(j,1,key='second-claim').stdout,r.stdout)
  self.assertEqual(scalar(f"select count(*) from private.visit_proposals where job_id='{j}';"),count)
  self.assertEqual(scalar(f"select count(*) from private.visit_notices where job_id='{j}';"),notices)
 def test_concurrent_claims_claim_whole_visit(self):
  j=self.attach(0);self.attach(1)
  with concurrent.futures.ThreadPoolExecutor(3) as pool:r=list(pool.map(lambda i:self.claim(j,i),range(3)))
  self.assertEqual(sum(x.returncode==0 for x in r),2,[x.stderr for x in r])
  self.assertEqual(scalar(f"select count(*) from assignments where job_id='{j}' and ended_at is null;"),'2')
 def test_single_cleaner_consent_decline_and_retry(self):
  j=self.attach(0);self.assertEqual(self.claim(j).returncode,0);self.attach(1);v=self.visit(j);proposal=v['proposals'][0]['id']
  self.assertEqual(v['job']['soloRateCents'],4500);self.assertEqual(sum(r['included'] for r in v['rooms']),1)
  r=self.consent(j,proposal,False,key='decline');self.assertEqual(r.returncode,0,r.stderr)
  self.assertEqual(self.consent(j,proposal,False,key='decline').stdout,r.stdout)
  v=self.visit(j);self.assertEqual(v['job']['soloRateCents'],4500);self.assertEqual(v['job']['activeCleanerCount'],1)
  self.assertEqual(scalar(f"select count(*) from jobs where house_id='{self.house}';"),'1')
  self.assertEqual(v['rooms'][1]['state'],'unresolved')
 def test_two_cleaner_consent_and_stale_response(self):
  j=self.attach(0);self.claim(j,0);self.claim(j,1);self.attach(1);v=self.visit(j);p=v['proposals'][0]['id']
  r=self.consent(j,p,i=0);self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(self.visit(j)['job']['soloRateCents'],4500)
  r=self.consent(j,p,i=1);self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(self.visit(j)['job']['soloRateCents'],6500)
  self.assertEqual(self.visit(j)['job']['sharedRateCents'],3250)
  self.assertIn('CONFLICT',self.consent(j,p,i=0).stderr)
 def test_price_and_membership_changes_reject_stale_consent(self):
  j=self.attach(0);self.claim(j);self.attach(1);p=self.visit(j)['proposals'][0]['id'];self.attach(2)
  self.assertIn('CONFLICT',self.consent(j,p).stderr)
  p=self.visit(j)['proposals'][0]['id'];sql(f"update house_visit_pricing set revision=revision+1 where house_id='{self.house}';")
  self.assertIn('CONFLICT',self.consent(j,p).stderr)
 def test_unclaimed_reference_uses_room_and_shared_definitions(self):
  j=self.attach(0);self.attach(1)
  shared=scalar(f"insert into house_items(house_id,kind,category,name) values('{self.house}','supply','Bathroom','Shared soap') returning id;")
  sql(f"insert into house_items(house_id,property_id,kind,category,name) values('{self.house}','{self.rooms[0]}','maintenance','Bedroom','Room lock'),('{self.house}','{self.rooms[2]}','supply','Bedroom','Unrelated towels');")
  read=lambda:json.loads(scalar(f"select bloom_job_supplies('{j}');",self.cleaners[0][0]))
  ref=read();self.assertEqual([i['name'] for i in ref['supplies']],['Shared soap']);self.assertEqual(ref['reports'],[])
  self.assertEqual(len(ref['roomReference']['rooms']),2)
  self.assertTrue(all(i['value'] is None and i['reportedAt'] is None for i in ref['roomReference']['items']))
  self.assertNotIn('Unrelated towels',json.dumps(ref));self.assertNotIn('PRIVATE-',json.dumps(ref))
  self.assertEqual(scalar(f"select count(*) from house_item_reports where item_id='{shared}';"),'0')
  self.assertIn('NOT_FOUND',sql(f"select bloom_job_supplies('{j}');",self.outsider,ok=False).stderr)
  other_city=scalar("insert into cities(name) values('Other reference city '||gen_random_uuid()) returning id;")
  other,_=make_user(city=other_city)
  self.assertIn('NOT_FOUND',sql(f"select bloom_job_supplies('{j}');",other,ok=False).stderr)
  sql(f"select bloom_house_items('{self.rooms[0]}','{shared}','report','low',0,null,'reference-restock');",self.owner)
  self.assertEqual(read()['reports'][0]['level'],'low')
  self.assertEqual(scalar(f"select count(*) from assignments where job_id='{j}';"),'0')
 def test_access_isolation_and_stock_history(self):
  j=self.attach(0);self.claim(j);self.attach(1)
  cleaner=self.cleaners[0][0];v=self.visit(j,cleaner);self.assertEqual(len(v['rooms']),1);self.assertNotIn('PRIVATE-2',json.dumps(v))
  self.assertIn('NOT_FOUND',sql(f"select bloom_room_visit('{j}');",self.outsider,ok=False).stderr)
  self.assertIn('NOT_FOUND',sql(f"select bloom_property_access_info('{self.rooms[1]}');",cleaner,ok=False).stderr)
  self.assertIn('PRIVATE-1',scalar(f"select bloom_property_access_info('{self.rooms[0]}');",cleaner))
  sql(f"select bloom_job_start('{j}','stock-start');",cleaner)
  item=scalar(f"insert into house_items(house_id,kind,category,name) values('{self.house}','supply','Shared stock','Soap') returning id;")
  self.assertIn('NOT_FOUND',sql(f"select bloom_house_items('{self.rooms[1]}','{item}','report','low',0,'{j}','unaccepted-report');",self.owner,ok=False).stderr)
  r=sql(f"select bloom_house_items('{self.rooms[0]}','{item}','report','low',0,'{j}','stock');",cleaner,ok=False);self.assertEqual(r.returncode,0,r.stderr)
  self.assertIn('CONFLICT',sql(f"select bloom_house_items('{self.rooms[0]}','{item}','report','full',0,'{j}','stale');",cleaner,ok=False).stderr)
 def test_unclaimed_extension_and_cancellation_preserve_turnover_identity(self):
  j=self.attach(0);tid=scalar(f"select id from private.room_turnovers where job_id='{j}';");day=scalar(f"select '{self.day}'::date+1;")
  newj=self.attach(0,day);self.assertNotEqual(j,newj);self.assertEqual(scalar(f"select id from private.room_turnovers where job_id='{newj}';"),tid)
  sql(f"select private.room_turnover_cancel('{tid}','Synthetic cancellation');")
  self.assertEqual(scalar(f"select status from jobs where id='{newj}';"),'cancelled')
  self.assertGreater(int(scalar(f"select count(*) from private.room_turnover_history where turnover_id='{tid}';")),2)
 def test_rooms_without_common_authorized_owner_require_review(self):
  other,other_id=make_user('owner');sql(f"delete from property_owners where property_id='{self.rooms[1]}';insert into property_owners values('{self.rooms[1]}','{other_id}');")
  j=self.attach(0);self.attach(1)
  self.assertEqual(self.visit(j)['job']['soloRateCents'],4500)
  self.assertEqual(len(self.visit(j)['rooms']),1)
  admin_view=self.visit(j,self.admin);self.assertEqual(admin_view['rooms'][1]['state'],'unresolved')
  self.assertIn('NOT_FOUND',sql(f"select bloom_room_visit('{j}');",other,ok=False).stderr)
 def test_claimed_extension_holds_original_agreement(self):
  j=self.attach(0);self.claim(j);day=scalar(f"select '{self.day}'::date+1;");self.assertEqual(self.attach(0,day),j)
  v=self.visit(j);self.assertTrue(v['job']['reviewRequired']);self.assertEqual(v['job']['soloRateCents'],4500);self.assertEqual(v['job']['activeCleanerCount'],1)
  self.assertEqual(scalar(f"select count(*) from jobs where house_id='{self.house}';"),'1')
 def test_house_pin_authorization_and_reuse(self):
  j=self.attach(0);self.attach(1);pin={'latitude':42.3,'longitude':-83.2,'confirmed':True}
  sql(f"select bloom_property_pin('{self.rooms[0]}',{js(pin)});",self.admin)
  self.assertEqual(json.loads(scalar(f"select bloom_property_pin('{self.rooms[1]}');",self.admin))['latitude'],42.3)
  self.assertIn('FORBIDDEN',sql(f"select bloom_property_pin('{self.rooms[0]}',{js(pin)});",self.owner,ok=False).stderr)
  self.assertEqual(len(json.loads(scalar(f"select bloom_day_pins('{self.day}');",self.cleaners[0][0]))),1)
  other,_=make_user(city=scalar("insert into cities(name) values('Synthetic other city') returning id;"))
  self.assertEqual(json.loads(scalar(f"select bloom_day_pins('{self.day}');",other)),[])
 def test_imported_calendar_grouping_extension_and_missing_review(self):
  from test_calendar_database import source,sync,event
  _,_,s1,_=source(actor=self.aid,prop=self.rooms[0]);_,_,s2,_=source(actor=self.aid,prop=self.rooms[1])
  e1=event(uid='room-1');e2=event(uid='room-2');sync(self.aid,s1,[e1]);sync(self.aid,s2,[e2])
  self.assertEqual(scalar(f"select count(*) from jobs where house_id='{self.house}';"),'1')
  self.assertEqual(scalar(f"select count(*) from private.room_turnovers where house_id='{self.house}';"),'2')
  tid=scalar(f"select id from private.room_turnovers where property_id='{self.rooms[0]}';")
  sync(self.aid,s1,[event(uid='room-1',end='2030-05-05')])
  self.assertEqual(scalar(f"select id from private.room_turnovers where property_id='{self.rooms[0]}';"),tid)
  self.assertEqual(scalar(f"select checkout_date from private.room_turnovers where id='{tid}';"),'2030-05-05')
  sync(self.aid,s1,[])
  self.assertEqual(scalar(f"select review_required from jobs where id=(select job_id from private.room_turnovers where id='{tid}');"),'t')
 def test_unchanged_source_reconciles_after_manual_conflict_is_resolved(self):
  from test_calendar_database import source,sync,event
  booking=scalar(f"insert into private.manual_bookings(property_id,check_in,checkout,checkin_time,checkout_time,timezone,created_by) values('{self.rooms[0]}','2030-05-01','2030-05-03','15:00','11:00','America/Detroit','{self.oid}') returning id;")
  _,_,sid,_=source(actor=self.aid,prop=self.rooms[0]);e=event(uid='resolved-room');sync(self.aid,sid,[e])
  self.assertEqual(scalar(f"select count(*) from private.room_turnovers where house_id='{self.house}';"),'0')
  self.assertGreater(int(scalar(f"select count(*) from calendar_changes where event_id in(select id from calendar_events where source_id='{sid}');")),0)
  sql(f"update private.manual_bookings set status='cancelled' where id='{booking}';")
  sync(self.aid,sid,[e]);self.assertEqual(scalar(f"select count(*) from private.room_turnovers where house_id='{self.house}';"),'1')
 def test_owner_cancellation_does_not_republish_from_source(self):
  j=self.attach(0);v=self.visit(j)
  r=sql(f"select bloom_room_visit_action('{j}','cancel_visit','{{}}',{v['job']['version']},'owner-cancel');",self.owner,ok=False);self.assertEqual(r.returncode,0,r.stderr)
  self.assertEqual(self.attach(1),j)
  self.assertEqual(scalar(f"select count(*) from jobs where house_id='{self.house}' and status='open';"),'0')
  self.assertEqual(scalar(f"select count(*) from private.room_turnovers where job_id='{j}' and included;"),'0')
 def test_manual_booking_identity_update_and_cancellation(self):
  day=scalar("select current_date+10;");ci=scalar("select current_date+5;")
  booking=scalar(f"insert into private.manual_bookings(property_id,check_in,checkout,checkin_time,checkout_time,timezone,created_by) values('{self.rooms[0]}','{ci}','{day}','15:00','11:00','America/Detroit','{self.oid}') returning id;")
  j=scalar(f"select set_config('request.jwt.claims','{{\"sub\":\"{self.owner}\",\"role\":\"authenticated\"}}',false);select private.manual_create_job('{self.rooms[0]}','{day}','{{}}','manual_booking','{booking}');")
  tid=scalar(f"select id from private.room_turnovers where booking_id='{booking}';")
  sql(f"update private.manual_bookings set checkout=checkout+1,version=version+1 where id='{booking}';")
  self.assertEqual(scalar(f"select count(*) from private.room_turnovers where booking_id='{booking}';"),'1')
  sql(f"update private.manual_bookings set status='cancelled',version=version+1 where id='{booking}';")
  self.assertEqual(scalar(f"select state from private.room_turnovers where id='{tid}';"),'cancelled')
 def test_incompatible_windows_do_not_expand_visit(self):
  j=self.attach(0)
  # Readiness after the current accepted window creates an exception, not another claimable job.
  sql(f"update private.room_turnovers set start_at=('{self.day}'::date+time '08:00') at time zone 'America/Detroit',end_at=('{self.day}'::date+time '10:00') at time zone 'America/Detroit' where job_id='{j}';select private.visit_refresh('{j}');")
  self.claim(j)
  sql(f"select private.room_turnover_attach('{self.rooms[1]}','{self.day}',('{self.day}'::date+time '11:00') at time zone 'America/Detroit',('{self.day}'::date+time '15:00') at time zone 'America/Detroit',null,null,'late-room');")
  self.assertEqual(scalar(f"select count(*) from jobs where house_id='{self.house}';"),'1')
  self.assertEqual(self.visit(j)['rooms'][1]['state'],'unresolved')
 def test_pricing_rules_authorization_history_and_accepted_snapshot(self):
  j=self.attach(0);self.claim(j)
  body={'firstHostCents':7500,'additionalHostCents':3000,'firstPoolCents':5500,'additionalPoolCents':2500}
  q=f"select bloom_house_pricing('{self.rooms[0]}',{js(body)},0,'price-update');"
  r=sql(q,self.owner,ok=False);self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(sql(q,self.owner).stdout,r.stdout)
  self.assertEqual(self.visit(j)['job']['soloRateCents'],4500)
  self.assertIn('REVIEW_REQUIRED',sql(f"select bloom_admin_set_pricing('{j}',9900,'override',true,{self.visit(j)['job']['version']},'Synthetic override');",self.admin,ok=False).stderr)
  self.assertEqual(scalar(f"select count(*) from private.house_pricing_history where house_id='{self.house}';"),'1')
  for sub in [self.cleaners[0][0],self.outsider]:self.assertIn('NOT_FOUND',sql(f"select bloom_house_pricing('{self.rooms[0]}');",sub,ok=False).stderr)
 def test_private_room_team_assignment_consent_and_decline(self):
  for p in self.rooms:
   sql(f"update properties set cleaning_management='private',private_capacity=2,private_total_cents=9000,private_payer_id='{self.oid}' where id='{p}';")
   for sub,uid in self.cleaners[:2]:sql(f"insert into private.property_cleaner_members(property_id,cleaner_id,default_assigned) values('{p}','{uid}',true);")
  q=lambda p:f"select set_config('request.jwt.claims','{{\"sub\":\"{self.owner}\",\"role\":\"authenticated\"}}',false);select private.manual_create_job('{p}','{self.day}','{{\"startTime\":\"00:00\",\"endTime\":\"23:59\"}}','manual_cleaning',null);"
  j=scalar(q(self.rooms[0]));self.assertEqual(self.visit(j)['job']['activeCleanerCount'],2)
  self.assertEqual(scalar(q(self.rooms[1])),j);v=self.visit(j);proposal=v['proposals'][0]['id'];self.assertEqual(v['job']['soloRateCents'],9000)
  self.assertEqual(self.consent(j,proposal,i=0).returncode,0);r=self.consent(j,proposal,i=1);self.assertEqual(r.returncode,0,r.stderr)
  self.assertEqual(len([r for r in self.visit(j)['rooms'] if r['included']]),2)
  r=sql(f"select bloom_decline_job('{j}','Synthetic private decline','decline-private');",self.cleaners[1][0],ok=False);self.assertEqual(r.returncode,0,r.stderr)
  self.assertEqual(self.visit(j)['job']['activeCleanerCount'],1)
  # Read-only private summaries require team authorization for every included room.
  sql(f"update jobs set status='completed',completed_at=now(),completed_by='{self.cleaners[0][1]}' where id='{j}';")
  sub,uid=self.cleaners[2]
  sql(f"insert into private.property_cleaner_members(property_id,cleaner_id) values('{self.rooms[0]}','{uid}');")
  self.assertNotIn(j,scalar(f"select bloom_jobs('{self.day}','{self.day}');",sub))
  self.assertIn('NOT_FOUND',sql(f"select bloom_cleaning_report('{j}');",sub,ok=False).stderr)
  sql(f"insert into private.property_cleaner_members(property_id,cleaner_id) values('{self.rooms[1]}','{uid}');")
  self.assertIn(j,scalar(f"select bloom_jobs('{self.day}','{self.day}');",sub))
  self.assertEqual(sql(f"select bloom_cleaning_report('{j}');",sub).returncode,0)
  self.assertIn('NOT_FOUND',sql(f"select bloom_room_visit('{j}');",sub,ok=False).stderr)
 def test_shared_reports_deduplicate_without_cleaning_a_space(self):
  j=self.attach(0);self.attach(1);self.claim(j);sql(f"select bloom_job_start('{j}','start');",self.cleaners[0][0])
  item=scalar(f"insert into house_items(house_id,kind,category,name) values('{self.house}','maintenance','Shared bathroom','Faucet') returning id;")
  def report(rev,key):return sql(f"select bloom_house_items('{self.rooms[0]}','{item}','report','issue',{rev},'{j}','{key}');",self.cleaners[0][0],ok=False)
  self.assertEqual(report(0,'issue').returncode,0);self.assertEqual(report(1,'same-issue').returncode,0)
  self.assertEqual(scalar(f"select count(*) from house_item_reports where item_id='{item}';"),'1')
  self.assertEqual(scalar(f"select count(*) from private.visit_space_completion where job_id='{j}';"),'0')
  self.assertEqual(scalar(f"select count(*) from private.visit_notices where job_id='{j}' and user_id='{self.oid}';"),'1')
 def test_pending_cancellation_preserves_accepted_price(self):
  j=self.attach(0);self.claim(j);self.attach(1);sql(f"update house_visit_pricing set first_pool_cents=9900,revision=revision+1 where house_id='{self.house}';")
  tid=scalar(f"select id from private.room_turnovers where property_id='{self.rooms[1]}';");sql(f"select private.room_turnover_cancel('{tid}','Synthetic pending cancellation');")
  self.assertEqual(self.visit(j)['job']['soloRateCents'],4500);self.assertEqual(self.visit(j)['job']['activeCleanerCount'],1)
 def test_summary_uses_frozen_definitions_and_reported_levels(self):
  j=self.attach(0);self.claim(j);sql(f"select bloom_job_start('{j}','start-summary');",self.cleaners[0][0])
  item=scalar(f"insert into house_items(house_id,kind,category,name) values('{self.house}','supply','Bathroom','Original soap') returning id;")
  sql(f"select bloom_house_items('{self.rooms[0]}','{item}','report','low',0,'{j}','summary-report');",self.cleaners[0][0])
  v=self.visit(j)
  for space in v['spaces']:
   sql(f"select bloom_room_visit_action('{j}','space',{js({'spaceId':space['id'],'done':True})},{v['job']['version']},'{uuid.uuid4()}');",self.cleaners[0][0])
   sql(f"insert into job_photos(job_id,uploader_id,category,room_id,object_path,state,bytes,mime) values('{j}','{self.cleaners[0][1]}','{space['type']}','{space['id']}','{uuid.uuid4()}','ready',100,'image/jpeg');")
  payload={'configVersion':v['job']['scopeRevision'],'answers':[],'notes':'Synthetic summary','maintenance':[],'guestReview':{'rating':5,'comment':''}}
  sql(f"select bloom_job_action('{j}','complete','snapshot-finish',null,{js(payload)});",self.cleaners[0][0])
  sql(f"select bloom_house_items('{self.rooms[0]}','{item}','rename','Renamed soap',1,null,'rename-summary');",self.owner)
  sql(f"select bloom_house_items('{self.rooms[0]}','{item}','report','full',2,null,'restocked-summary');",self.owner)
  report=json.loads(scalar(f"select bloom_cleaning_report('{j}');",self.cleaners[1][0]))
  self.assertEqual(report['roomSummary']['items'][0]['name'],'Original soap')
  self.assertEqual(report['roomSummary']['items'][0]['value'],'low')
  reference=json.loads(scalar(f"select bloom_job_supplies('{j}');",self.cleaners[1][0]))
  self.assertEqual(reference['roomReference']['items'][0]['value'],'low')
  self.assertEqual(len(report['roomSummary']['rooms']),1)
  self.assertNotIn('PRIVATE-',json.dumps(report))
 def test_shared_completion_and_either_cleaner_payout(self):
  j=self.attach(0);self.attach(1);self.claim(j,0);self.claim(j,1)
  r=sql(f"select bloom_job_start('{j}','start');",self.cleaners[0][0],ok=False);self.assertEqual(r.returncode,0,r.stderr)
  v=self.visit(j);version=v['job']['version']
  for space in v['spaces']:
   r=sql(f"select bloom_room_visit_action('{j}','space',{js({'spaceId':space['id'],'done':True})},{version},'{uuid.uuid4()}');",self.cleaners[1][0],ok=False);self.assertEqual(r.returncode,0,r.stderr)
   sql(f"insert into job_photos(job_id,uploader_id,category,room_id,object_path,state,bytes,mime) values('{j}','{self.cleaners[1][1]}','{space['type']}','{space['id']}','{uuid.uuid4()}','ready',100,'image/jpeg');")
  config=json.loads(scalar(f"select cleaning_config from jobs where id='{j}';"))
  payload={'configVersion':config['version'],'answers':[],'notes':'','maintenance':[{'category':c,'status':'not_applicable','notes':''} for c in ['painting','fridge','electricity','wifi','tv','garage','climate','water']],'guestReview':{'rating':5,'comment':''}}
  r=sql(f"select bloom_job_action('{j}','complete','finish',null,{js(payload)});",self.cleaners[1][0],ok=False);self.assertEqual(r.returncode,0,r.stderr)
  self.assertEqual(scalar(f"select count(*) from assignments where job_id='{j}' and completed_pay_cents=3250;"),'2')
  receipt=json.loads(scalar(f"select completion_receipt from jobs where id='{j}';"))
  self.assertEqual(len(receipt['roomSummary']['rooms']),2)
  self.assertEqual(len(receipt['roomSummary']['spaces']),5)
  self.assertNotIn('PRIVATE-',json.dumps(receipt['roomSummary']))
  self.assertEqual(scalar(f"select count(*) from private.visit_space_completion where job_id='{j}';"),'5')
  self.assertEqual(sql(f"select bloom_photos('{j}');",self.cleaners[2][0]).returncode,0)
  self.assertIsNone(self.visit(j,self.cleaners[1][0])['rooms'][0]['access'])
  # Completed-room calendar cards, receipts, notes and photos share one boundary.
  assigned=self.cleaners[0][0];unassigned=self.cleaners[2][0]
  self.assertIn(j,scalar(f"select bloom_jobs('{self.day}','{self.day}');",assigned))
  self.assertIn(j,scalar(f"select bloom_jobs('{self.day}','{self.day}');",unassigned))
  self.assertEqual(sql(f"select bloom_cleaning_report('{j}');",unassigned).returncode,0)
  self.assertIn('DH1 & DH2',json.loads(scalar(f"select bloom_cleaning_report('{j}');",assigned))['propertyName'])
  for section in ['supplies','maintenance']:
   self.assertEqual(json.loads(scalar(f"select bloom_job_notes('{j}','{section}');",assigned)),[])
   self.assertEqual(json.loads(scalar(f"select bloom_job_notes('{j}','{section}');",unassigned)),[])
   self.assertIn('NOT_FOUND',sql(f"select bloom_job_notes('{j}','{section}','Late edit','late-{section}');",assigned,ok=False).stderr)
  self.assertEqual(sql(f"select bloom_house_items('{self.rooms[0]}',p_job=>'{j}');",assigned).returncode,0)
  self.assertIn('NOT_FOUND',sql(f"select bloom_room_visit('{j}');",unassigned,ok=False).stderr)
  self.assertIn('NOT_FOUND',sql(f"select bloom_house_items('{self.rooms[0]}',p_job=>'{j}');",unassigned,ok=False).stderr)
  for section in ['supplies','maintenance']:
   self.assertIn('NOT_FOUND',sql(f"select bloom_job_notes('{j}','{section}','Unauthorized edit','readonly-{section}');",unassigned,ok=False).stderr)
  other_city=scalar("insert into cities(name) values('Outside summary city '||gen_random_uuid()) returning id;")
  outsider_cleaner,_=make_user(city=other_city)
  for function in ['bloom_cleaning_report','bloom_photos']:
   self.assertIn('NOT_FOUND',sql(f"select {function}('{j}');",outsider_cleaner,ok=False).stderr)
  self.assertEqual(sql(f"select bloom_cleaning_report('{j}');",self.owner).returncode,0)
  self.assertEqual(sql(f"select bloom_cleaning_report('{j}');",self.admin).returncode,0)
  self.assertIn('NOT_FOUND',sql(f"select bloom_cleaning_report('{j}');",self.outsider,ok=False).stderr)
  self.assertEqual(sql(f"select bloom_job_action('{j}','complete','finish',null,{js(payload)});",self.cleaners[1][0]).stdout,r.stdout)
  self.assertEqual(self.attach(2),j)
  self.assertEqual(scalar(f"select solo_rate_cents_snapshot from jobs where id='{j}';"),'6500')
  self.assertEqual(scalar(f"select count(*) from jobs where house_id='{self.house}';"),'1')
  self.assertEqual(self.visit(j)['rooms'][2]['state'],'unresolved')

if __name__=='__main__':unittest.main(verbosity=2)
