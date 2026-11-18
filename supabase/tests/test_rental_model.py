"""Entire unit <-> room model conversions (migration 104) against real disposable PostgreSQL.
Verified JWT claims are simulated; no hosted writes."""
import concurrent.futures,json,unittest,uuid
from test_database import sql,scalar,make_user,CITY
from test_calendar_database import source,sync,event,rpc,data

def js(v):return "'"+json.dumps(v).replace("'","''")+"'::jsonb"
ACCESS={'entryType':'keypad','code':'2468','entryNotes':'','parking':['driveway'],'garageCode':'','parkingNotes':''}
PRICING={'firstHostCents':6500,'additionalHostCents':2500,'firstPoolCents':4500,'additionalPoolCents':2000}
SHARED=[{'kind':'kitchen','label':'Kitchen'},{'kind':'house_laundry','label':'Laundry'},{'kind':'outdoor','label':'Backyard'}]

class RentalModel(unittest.TestCase):
 def setUp(self):
  self.admin,self.aid=make_user('admin');self.owner,self.oid=make_user('owner');self.outsider,_=make_user('owner');self.cleaner,self.cid=make_user()
 # Fixtures ---------------------------------------------------------------------------------
 def unit(self,checkout='2030-05-03',stay=True):
  p=scalar(f"insert into properties(city_id,name,address,solo_rate_cents) values('{CITY}','TEST Trumbull {uuid.uuid4().hex[:6]}','Synthetic Trumbull address',6000) returning id;")
  sql(f"insert into property_owners values('{p}','{self.oid}');insert into property_entry_instructions(property_id,instructions,access_info) values('{p}','Synthetic cleaning steps','{json.dumps({**ACCESS,'code':'UNIT-CODE'})}');")
  _,_,sid,_=source(actor=self.aid,prop=p)
  if not stay:return p,sid,None
  self.ev=event(uid='stay-'+uuid.uuid4().hex,start='2030-05-01',end=checkout);sync(self.aid,sid,[self.ev])
  job=scalar(f"select id from jobs where property_id='{p}';")
  return p,sid,job
 def call(self,prop,action='read',payload=None,sub=None,key=None):
  key=key or uuid.uuid4().hex
  return sql(f"select bloom_rental_model('{prop}','{action}',{js(payload) if payload is not None else 'null'},'{key}');",sub or self.owner,ok=False)
 def ok(self,result):
  self.assertEqual(result.returncode,0,result.stderr);return json.loads(result.stdout.strip().splitlines()[-1])
 def read(self,prop,sub=None):return self.ok(sql(f"select bloom_rental_model('{prop}');",sub or self.owner,ok=False))
 def split(self,prop,rooms=3,keep=0,**extra):
  spec=[{'name':f'Room {i+1}','identifier':f'R{i+1}'} for i in range(rooms)]
  if rooms>1:spec[1]['access']=ACCESS
  spec[keep]['access']='copy'
  return self.call(prop,'split',{'rooms':spec,'keep':keep,'shared':SHARED,'pricing':PRICING,**extra})
 def rooms(self,house):return scalar(f"select coalesce(string_agg(id::text,',' order by lower(room_identifier)),'') from properties where house_id='{house}' and archived_at is null and deleted_at is null;").split(',')
 def merge(self,prop,survivor,when='now',sub=None,key=None):return self.call(prop,'merge',{'survivorId':survivor,'name':'TEST merged unit','when':when},sub,key)
 def stay(self,prop,uid,start,end):
  sid=scalar(f"select id from calendar_sources where property_id='{prop}' and enabled order by created_at limit 1;") if scalar(f"select count(*) from calendar_sources where property_id='{prop}' and enabled;")!='0' else source(actor=self.aid,prop=prop)[2]
  return sid,sync(self.aid,sid,[event(uid=uid,start=start,end=end)])

 # Split ------------------------------------------------------------------------------------
 def test_split_keeps_original_calendar_reservations_and_jobs(self):
  p,sid,job=self.unit();sql(f"insert into private.property_cleaner_members(property_id,cleaner_id) values('{p}','{self.cid}');")
  before_events=scalar(f"select count(*) from calendar_events where source_id='{sid}';")
  r=self.ok(self.split(p));house=r['houseId']
  self.assertEqual([x['id']==p for x in r['rooms']],[True,False,False]);self.assertTrue(r['rooms'][0]['keepsCalendar'])
  self.assertEqual(scalar(f"select listing_type||'|'||house_id||'|'||active||'|'||channel_check_required from properties where id='{p}';"),f'room|{house}|true|true')
  self.assertEqual(scalar(f"select id||'|'||enabled from calendar_sources where property_id='{p}';"),f'{sid}|true')
  self.assertEqual(scalar(f"select count(*) from calendar_events where source_id='{sid}';"),before_events)
  # Same job, now the house visit, linked to the same reservation.
  self.assertEqual(scalar(f"select id||'|'||house_id||'|'||status from jobs where property_id='{p}';"),f'{job}|{house}|open')
  self.assertEqual(scalar(f"select count(*) from private.room_turnovers t join job_events je on je.event_id=t.event_id where t.job_id='{job}' and t.included and t.property_id='{p}';"),'1')
  self.assertEqual(scalar(f"select solo_rate_cents_snapshot||'|'||host_charge_cents_snapshot from jobs where id='{job}';"),'4500|6500')
  others=[x['id'] for x in r['rooms'][1:]]
  self.assertEqual([x['status'] for x in r['rooms'][1:]],['needs_channel_link','draft'])
  for o in others:
   self.assertEqual(scalar(f"select (select count(*) from calendar_sources where property_id='{o}')+(select count(*) from jobs where property_id='{o}')+(select count(*) from private.manual_bookings where property_id='{o}');"),'0')
   self.assertEqual(scalar(f"select count(*) from property_owners where property_id='{o}' and owner_id='{self.oid}';"),'1')
   self.assertEqual(scalar(f"select count(*) from private.property_cleaner_members where property_id='{o}' and cleaner_id='{self.cid}';"),'1')
  self.assertEqual(scalar(f"select string_agg(label,',' order by label) from house_spaces where house_id='{house}' and property_id is null;"),'Backyard,Kitchen,Laundry')
  self.assertEqual(scalar(f"select count(*) from house_spaces where house_id='{house}' and kind='bedroom';"),'3')
  self.assertEqual(scalar(f"select string_agg(h.event,',' order by h.created_at) from private.listing_conversion_history h join private.listing_conversions c on c.id=h.conversion_id where c.house_id='{house}';"),'split')
  self.assertEqual(scalar(f"select actor_id from private.listing_conversions where house_id='{house}';"),self.oid)
  # Resyncing the unchanged feed must not duplicate the visit; a new stay joins grouped visits.
  sync(self.aid,sid,[self.ev]);self.assertEqual(scalar(f"select count(*) from jobs where house_id='{house}';"),'1')
  sync(self.aid,sid,[self.ev,event(uid='after-split',start='2030-06-01',end='2030-06-04')])
  self.assertEqual(scalar(f"select count(*) from jobs where house_id='{house}' and checkout_date='2030-06-04';"),'1')
  self.assertEqual(scalar(f"select count(*) from jobs where property_id='{p}' and house_id is null;"),'0')
 def test_split_choosing_another_room_to_keep_the_calendar(self):
  p,sid,job=self.unit();r=self.ok(self.split(p,rooms=2,keep=1))
  self.assertEqual(r['rooms'][0]['id'],p);self.assertEqual(scalar(f"select room_identifier from properties where id='{p}';"),'R2')
 def test_split_refused_while_a_future_cleaning_is_claimed(self):
  p,sid,job=self.unit();houses=scalar("select count(*) from houses;")
  sql(f"insert into assignments(job_id,cleaner_id,slot) values('{job}','{self.cid}',1);")
  self.assertIn('CONFLICT',self.split(p).stderr)
  self.assertEqual(scalar(f"select listing_type||'|'||coalesce(house_id::text,'') from properties where id='{p}';"),'entire_home|')
  self.assertEqual(scalar("select count(*) from houses;"),houses)
  self.assertTrue(self.read(p)['splitDefaults']['blockedByClaimedCleaning'])
 def test_split_validation_permissions_and_pricing_requirement(self):
  p,_,_=self.unit()
  self.assertIn('VALIDATION_ERROR',self.split(p,rooms=1).stderr)
  dup=[{'name':'A','identifier':'R1'},{'name':'B','identifier':'r1'}]
  self.assertIn('VALIDATION_ERROR',self.call(p,'split',{'rooms':dup,'keep':0,'shared':SHARED,'pricing':PRICING}).stderr)
  self.assertIn('REVIEW_REQUIRED',self.call(p,'split',{'rooms':[{'name':'A','identifier':'A'},{'name':'B','identifier':'B'}],'keep':0,'shared':SHARED}).stderr)
  self.assertIn('VALIDATION_ERROR',self.call(p,'split',{'rooms':[{'name':'A','identifier':'A'},{'name':'B','identifier':'B'}],'keep':0,'pricing':PRICING}).stderr)
  self.assertIn('NOT_FOUND',self.call(p,'read',sub=self.outsider).stderr)
  self.assertIn('NOT_FOUND',self.call(p,'split',{'rooms':[],'keep':0},sub=self.outsider).stderr)
  self.assertIn('FORBIDDEN',self.call(p,'read',sub=self.cleaner).stderr)
  defaults=self.read(p)['splitDefaults']['pricing'];self.assertEqual(defaults['firstPoolCents'],6000)
  self.ok(self.split(p));self.assertIn('CONFLICT',self.split(p).stderr)
 def test_split_receipt_replays_and_admin_can_convert(self):
  p,_,_=self.unit();key='split-'+uuid.uuid4().hex
  payload={'rooms':[{'name':'A','identifier':'A','access':'copy'},{'name':'B','identifier':'B'}],'keep':0,'shared':SHARED,'pricing':PRICING}
  first=self.ok(self.call(p,'split',payload,sub=self.admin,key=key));self.assertEqual(self.ok(self.call(p,'split',payload,sub=self.admin,key=key)),first)
  self.assertEqual(scalar(f"select actor_id from private.listing_conversions where id='{first['conversionId']}';"),self.aid)
 def test_concurrent_splits_create_one_house(self):
  p,_,_=self.unit()
  with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda _:self.split(p),range(2)))
  self.assertEqual(sorted(r.returncode for r in results),[0,3],[r.stderr for r in results])
  self.assertTrue(any('CONFLICT' in r.stderr for r in results))
  self.assertEqual(scalar(f"select count(*) from properties where house_id=(select house_id from properties where id='{p}');"),'3')

 # Archived history, owners and teams ---------------------------------------------------------------
 def test_house_owners_and_team_edits_apply_to_every_room(self):
  p,_,_=self.unit();house=self.ok(self.split(p))['houseId'];rooms=self.rooms(house);co,coid=make_user('owner')
  sql(f"insert into property_owners values('{rooms[1]}','{coid}');")
  self.assertEqual(scalar(f"select count(*) from property_owners where owner_id='{coid}';"),'3')
  sql(f"delete from property_owners where property_id='{rooms[2]}' and owner_id='{coid}';")
  self.assertEqual(scalar(f"select count(*) from property_owners where owner_id='{coid}';"),'0')
  sql(f"insert into private.property_cleaner_members(property_id,cleaner_id) values('{rooms[0]}','{self.cid}');")
  sql(f"update private.property_cleaner_members set default_assigned=true where property_id='{rooms[2]}' and cleaner_id='{self.cid}';")
  self.assertEqual(scalar(f"select string_agg(default_assigned::text,',') from private.property_cleaner_members where cleaner_id='{self.cid}';"),'true,true,true')
  sql(f"update properties set private_capacity=3 where id='{rooms[1]}';")
  self.assertEqual(scalar(f"select string_agg(distinct private_capacity::text,',') from properties where house_id='{house}';"),'3')
  sql(f"delete from private.property_cleaner_members where property_id='{rooms[1]}' and cleaner_id='{self.cid}';")
  self.assertEqual(scalar(f"select count(*) from private.property_cleaner_members where cleaner_id='{self.cid}';"),'0')
 def test_pending_house_owner_reaches_every_room_including_later_drafts(self):
  p,_,_=self.unit();house=self.ok(self.split(p))['houseId'];rooms=self.rooms(house)
  mail=f'atam-{uuid.uuid4().hex[:6]}@example.test'
  sql(f"insert into private.pending_property_owners(property_id,email,created_by) values('{rooms[0]}','{mail}','{self.aid}');")
  self.assertEqual(scalar(f"select count(*) from private.pending_property_owners where email='{mail}';"),'3')
  later=scalar(f"insert into properties(city_id,name,address,house_id,listing_type,room_identifier,active,draft_data) values('{CITY}','Room 4','x','{house}','room','R4',false,'{{}}') returning id;")
  self.assertEqual(scalar(f"select count(*) from private.pending_property_owners where email='{mail}' and property_id='{later}';"),'1')
  self.assertEqual(scalar(f"select count(*) from property_owners where property_id='{later}' and owner_id='{self.oid}';"),'1')
 def test_activation_needs_only_one_shared_space(self):
  p,_,_=self.unit();r=self.ok(self.call(p,'split',{'rooms':[{'name':'A','identifier':'A','access':'copy'},{'name':'B','identifier':'B'}],'keep':0,'shared':[{'kind':'house_laundry','label':'Laundry'}],'pricing':PRICING}))
  draft=r['rooms'][1]['id'];self.assertEqual(r['rooms'][1]['status'],'draft')
  info=json.loads(scalar(f"select bloom_property_access_info('{draft}');",self.owner))['info']
  sql(f"select bloom_property_access_info('{draft}',{js({**ACCESS,'version':info['version']})});",self.owner)
  rev=scalar(f"select draft_revision from properties where id='{draft}';")
  sql(f"select bloom_listing_drafts('{draft}','activate',null,{rev},'activate-{uuid.uuid4().hex}');",self.owner)
  self.assertEqual(self.read(draft)['listing']['status'],'needs_channel_link')

 # Merge ------------------------------------------------------------------------------------
 def test_merge_waits_for_last_checkout_can_be_cancelled_then_runs(self):
  p,sid,job=self.unit();house=self.ok(self.split(p,rooms=4))['houseId'];rooms=self.rooms(house);survivor=rooms[1]
  for r in rooms[1:]:sql(f"update property_entry_instructions set access_info=access_info||'{{\"code\":\"X\"}}' where property_id='{r}';update properties set active=true,draft_data=null where id='{r}';")
  s2,_=self.stay(rooms[2],'room3-stay','2030-07-01','2030-07-04')
  self.assertIn('CONFLICT',self.merge(p,survivor).stderr)
  pending=self.ok(self.merge(p,survivor,'after_last_checkout'));self.assertEqual(pending['state'],'pending');self.assertEqual(pending['lastCheckout'],'2030-07-04')
  self.assertEqual(scalar(f"select scheduled_for at time zone 'America/Detroit' from private.listing_conversions where id='{pending['conversionId']}';"),'2030-07-05 00:00:00')
  self.assertIn('CONFLICT',self.merge(p,survivor,'after_last_checkout').stderr)
  # Rooms stay bookable; a later booking pushes the merge back.
  self.stay(rooms[3],'room4-stay','2030-08-01','2030-08-09')
  at=self.read(rooms[0])['pendingMerge']['scheduledFor']
  self.assertEqual(scalar(f"select '{at}'::timestamptz at time zone 'America/Detroit';"),'2030-08-10 00:00:00')
  listing=[i for i in json.loads(scalar("select bloom_owner_listings();",self.owner))['items'] if i['id']==rooms[3]][0]
  self.assertEqual(listing['pendingMerge']['id'],pending['conversionId'])
  self.ok(self.call(p,'cancel_merge',{}));self.assertIsNone(self.read(p)['pendingMerge'])
  self.assertIn('NOT_FOUND',self.call(p,'cancel_merge',{}).stderr)
  again=self.ok(self.merge(p,survivor,'after_last_checkout'))
  # Not due yet: the scheduler leaves it alone.
  self.assertEqual(scalar("select private.run_due_conversions();"),'0')
  # The stays end (cancelled here); once due, the scheduler runs it.
  sync(self.aid,s2,[event(uid='room3-stay',start='2030-07-01',end='2030-07-04',status='cancelled')])
  sync(self.aid,sid,[event(uid=self.ev['uid'],start=self.ev['startDate'],end=self.ev['endDate'],status='cancelled')])
  s3=scalar(f"select id from calendar_sources where property_id='{rooms[3]}';");sync(self.aid,s3,[event(uid='room4-stay',start='2030-08-01',end='2030-08-09',status='cancelled')])
  sql(f"update private.listing_conversions set scheduled_for=clock_timestamp()-interval '1 minute' where id='{again['conversionId']}';")
  self.assertEqual(scalar("select private.run_due_conversions();"),'1')
  self.assert_merged(house,survivor,[rooms[0],rooms[2],rooms[3]])
  self.assertEqual(scalar(f"select string_agg(event,',' order by created_at) from private.listing_conversion_history where conversion_id='{again['conversionId']}';"),'merge_scheduled,merged')
  self.assertEqual(scalar(f"select count(*) from private.listing_conversion_history where conversion_id='{again['conversionId']}' and event='merged' and actor_id is null;"),'1')  # the scheduler ran it
  # Room 1's stay was cancelled before the merge, so its visit was cancelled with it (history kept).
  self.assertEqual(scalar(f"select status from jobs where id='{job}';"),'cancelled')
 def assert_merged(self,house,survivor,archived):
  self.assertEqual(scalar(f"select listing_type||'|'||coalesce(house_id::text,'')||'|'||former_house_id||'|'||channel_check_required||'|'||name from properties where id='{survivor}';"),f'entire_home||{house}|true|TEST merged unit')
  for r in archived:
   self.assertEqual(scalar(f"select (archived_at is not null)||'|'||active||'|'||house_id from properties where id='{r}';"),f'true|false|{house}')
   self.assertEqual(scalar(f"select count(*) from calendar_sources where property_id='{r}' and enabled;"),'0')
   self.assertEqual(scalar(f"select count(*) from private.calendar_exports where property_id='{r}' and enabled;"),'0')
  self.assertEqual(scalar(f"select archived_at is not null from houses where id='{house}';"),'t')
  self.assertEqual(scalar(f"select count(*) from private.listing_conversions where house_id='{house}' and state='pending';"),'0')
 def test_merge_now_turns_survivor_visits_back_into_unit_cleanings(self):
  p,sid,job=self.unit();house=self.ok(self.split(p,rooms=2))['houseId'];rooms=self.rooms(house)
  sql(f"insert into private.calendar_exports(property_id,token,token_hash) values('{rooms[1]}','t-{uuid.uuid4().hex}',encode(sha256(gen_random_uuid()::text::bytea),'hex'));")
  r=self.ok(self.merge(p,p));self.assertEqual(r['state'],'done');self.assert_merged(house,p,[rooms[1]])
  self.assertEqual(scalar(f"select property_id||'|'||coalesce(house_id::text,'')||'|'||status||'|'||solo_rate_cents_snapshot||'|'||to_char(start_at at time zone 'America/Detroit','HH24:MI') from jobs where id='{job}';"),f'{p}||open|6000|11:00')
  self.assertEqual(scalar(f"select count(*) from private.room_turnovers where job_id='{job}' and included;"),'0')
  self.assertEqual(scalar(f"select cleaning_config is not null and unit_cleaning_config is null from properties where id='{p}';"),'t')
  # The unit's own feed keeps working on the entire-unit path.
  sync(self.aid,sid,[self.ev,event(uid='after-merge',start='2030-09-01',end='2030-09-03')])
  self.assertEqual(scalar(f"select count(*) from jobs where property_id='{p}' and house_id is null and status='open';"),'2')
 def test_split_merge_split_reuses_the_archived_house_without_orphans(self):
  p,sid,job=self.unit();house=self.ok(self.split(p))['houseId'];houses=scalar("select count(*) from houses;")
  self.ok(self.merge(p,p))
  r=self.ok(self.split(p));self.assertEqual(r['houseId'],house);self.assertEqual(scalar("select count(*) from houses;"),houses)
  self.assertEqual(scalar(f"select archived_at is null from houses where id='{house}';"),'t')
  self.assertEqual(scalar(f"select count(*) from properties where house_id='{house}' and archived_at is null;"),'3')
  self.assertEqual(scalar(f"select count(*) from properties where house_id='{house}' and archived_at is not null;"),'2')
  self.assertEqual(scalar("select count(*) from properties where listing_type='room' and house_id is null;"),'0')
  self.assertEqual(scalar("select count(*) from private.room_turnovers where job_id is null;"),'0')
  self.assertEqual(scalar(f"select count(*) from (select label from house_spaces where house_id='{house}' group by label having count(*)>1)x;"),'0')
  self.assertEqual(scalar(f"select string_agg(kind||':'||state,',' order by created_at) from private.listing_conversions where house_id='{house}';"),'split:done,merge:done,split:done')
  self.assertEqual(scalar(f"select house_id from jobs where id='{job}';"),house)
 def test_concurrent_merges_run_once(self):
  p,_,_=self.unit();house=self.ok(self.split(p))['houseId'];rooms=self.rooms(house)
  with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda s:self.merge(p,s),[rooms[0],rooms[0]]))
  ok=[r for r in results if r.returncode==0];self.assertGreaterEqual(len(ok),1)
  for r in results:
   if r.returncode:self.assertTrue('CONFLICT' in r.stderr or 'NOT_FOUND' in r.stderr,r.stderr)
  self.assertEqual(scalar(f"select count(*) from private.listing_conversions where house_id='{house}' and kind='merge' and state='done';"),'1')
 def test_archived_rooms_are_readable_history_but_read_only(self):
  p,_,_=self.unit();house=self.ok(self.split(p,rooms=2))['houseId'];rooms=self.rooms(house);gone=rooms[1]
  for r in rooms:sql(f"update properties set active=true,draft_data=null where id='{r}';")
  yesterday=scalar("select (now() at time zone 'America/Detroit')::date-1;")
  visit=None
  for r in rooms:visit=scalar(f"select private.room_turnover_attach('{r}','{yesterday}',('{yesterday}'::date+time '12:00') at time zone 'America/Detroit',('{yesterday}'::date+time '14:00') at time zone 'America/Detroit',null,null,'past-{r}');")
  self.ok(self.merge(p,p))
  v=json.loads(scalar(f"select bloom_room_visit('{visit}');",self.owner));self.assertEqual(len(v['rooms']),2)
  info=json.loads(scalar(f"select bloom_property_access_info('{gone}');",self.owner));self.assertFalse(info['canEdit'])
  self.assertIn('CONFLICT',sql(f"select bloom_property_access_info('{gone}',{js({**ACCESS,'version':info['info']['version']})});",self.owner,ok=False).stderr)
  self.assertIn('NOT_FOUND',sql(f"select bloom_property_access_info('{gone}');",self.outsider,ok=False).stderr)
  self.assertEqual(self.read(gone)['listing']['status'],'archived');self.assertFalse(self.read(gone)['listing']['canConvert'])
  self.assertIn('NOT_FOUND',self.call(gone,'confirm_channel',{}).stderr)
  item=[i for i in json.loads(scalar("select bloom_owner_listings();",self.owner))['items'] if i['id']==gone][0]
  self.assertTrue(item['isArchived']);self.assertEqual(item['status'],'archived')
  self.assertIn('CONFLICT',sql(f"update properties set active=true where id='{gone}';",ok=False).stderr)
  self.assertIn('CONFLICT',sql(f"insert into calendar_sources(property_id,provider,encrypted_url,fingerprint,url_digest) values('{gone}','airbnb','x','{uuid.uuid4().hex*2}','{uuid.uuid4().hex*2}');",ok=False).stderr)
  self.ok(self.call(p,'confirm_channel',{}));self.assertFalse(self.read(p)['listing']['channelCheckRequired'])

 # One link per live listing ----------------------------------------------------------------------
 def test_ical_link_and_airbnb_url_map_to_one_live_listing(self):
  a,_,_=self.unit(stay=False);b,_,_=self.unit();digest=uuid.uuid4().hex*2
  body=lambda prop:dict(propertyId=prop,provider='vrbo',encryptedUrl='v1.'+'a'*16+'.'+'b'*22+'.'+'c'*80,fingerprint=uuid.uuid4().hex*2,urlDigest=digest)
  rpc('bloom_calendar_add_source',dict(p_actor=self.aid,p_input=body(a),p_key=uuid.uuid4().hex))
  self.assertIn('CONFLICT',rpc('bloom_calendar_add_source',dict(p_actor=self.aid,p_input=body(b),p_key=uuid.uuid4().hex),False).stderr)
  url=f'https://www.airbnb.com/rooms/{uuid.uuid4().int%10**12}'
  sql(f"update properties set airbnb_listing_url='{url}' where id='{a}';")
  self.assertIn('CONFLICT',sql(f"update properties set airbnb_listing_url='{url.upper()}' where id='{b}';",ok=False).stderr)
  # Once the first listing is archived by a merge, the link may be reused.
  house=self.ok(self.split(a,rooms=2,keep=1))['houseId'];rooms=self.rooms(house);survivor=[r for r in rooms if r!=a][0]
  sql(f"update properties set active=true,draft_data=null where id='{survivor}';")
  self.ok(self.merge(survivor,survivor))
  rpc('bloom_calendar_add_source',dict(p_actor=self.aid,p_input=body(b),p_key=uuid.uuid4().hex))
  sql(f"update properties set airbnb_listing_url='{url}' where id='{b}';")

if __name__=='__main__':unittest.main()
