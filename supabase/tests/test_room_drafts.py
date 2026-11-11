"""Real local Postgres; JWT claims are simulated, external services are not called."""
import concurrent.futures,json,unittest,uuid
from test_database import sql,scalar,make_user,CITY

class RoomDrafts(unittest.TestCase):
 def setUp(self):
  self.admin,self.aid=make_user('admin');self.owner,self.oid=make_user('owner');self.other,_=make_user('owner');self.cleaner,_=make_user()
  self.house=scalar(f"insert into houses(name,address,created_by) values('House','Confirmed address','{self.aid}') returning id;")
  self.p=scalar(f"insert into properties(city_id,name,address,house_id,listing_type,active,draft_data,room_identifier) values('{CITY}','DH1','Wrong address','{self.house}','room',false,'{{}}','DH1') returning id;")
  self.p2=scalar(f"insert into properties(city_id,name,address,house_id,listing_type,active,draft_data,room_identifier) values('{CITY}','DH2','Wrong address','{self.house}','room',false,'{{}}','DH2') returning id;")
  sql(f"insert into property_owners values('{self.p}','{self.oid}'),('{self.p2}','{self.oid}');")
  self.item=scalar(f"insert into house_items(house_id,kind,category,name) values('{self.house}','supply','Bathroom','Toilet paper') returning id;")
 def drafts(self,sub=None):return json.loads(scalar('select bloom_listing_drafts();',sub or self.owner))
 def action(self,action='save',revision=0,key=None,sub=None):
  return sql(f"select bloom_listing_drafts('{self.p}','{action}','{{\"name\":\"Edited\",\"identifier\":\"DH1\"}}',{revision},'{key or uuid.uuid4()}');",sub or self.owner,ok=False)
 def report(self,revision=0,key=None,sub=None,prop=None):
  return sql(f"select bloom_house_items('{prop or self.p}','{self.item}','report','low',{revision},null,'{key or uuid.uuid4()}');",sub or self.owner,ok=False)
 def test_draft_access_and_thumbnail_controls_keep_owner_boundary(self):
  self.assertTrue(json.loads(scalar(f"select bloom_property_access_info('{self.p}');",self.owner))['canEdit'])
  self.assertTrue(json.loads(scalar(f"select bloom_property_airbnb('{self.p}');",self.owner))['canEdit'])
  for sub in [self.other,self.cleaner]:
   self.assertIn('NOT_FOUND',sql(f"select bloom_property_access_info('{self.p}');",sub,ok=False).stderr)
   self.assertIn('NOT_FOUND',sql(f"select bloom_property_airbnb('{self.p}');",sub,ok=False).stderr)
 def test_address_draft_isolation_and_retry(self):
  self.assertEqual(scalar(f"select address from properties where id='{self.p}';"),'Confirmed address')
  self.assertEqual(len(self.drafts()),2);self.assertEqual(self.drafts(self.other),[])
  self.assertIn('FORBIDDEN',sql('select bloom_listing_drafts();',self.cleaner,ok=False).stderr)
  r=self.action(key='save');self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(self.action(key='save').stdout,r.stdout)
  self.assertIn('CONFLICT',self.action().stderr)
  self.assertIn('NOT_FOUND',self.action(sub=self.other).stderr)
  self.assertEqual(self.drafts()[0]['revision']+self.drafts()[1]['revision'],1)
 def test_unknown_shared_stock_and_history_stale_write(self):
  def items(prop):return json.loads(scalar(f"select bloom_house_items('{prop}');",self.owner))
  self.assertIsNone(items(self.p)[0]['value']);self.assertIsNone(items(self.p)[0]['reportedAt'])
  self.assertEqual(items(self.p)[0]['id'],items(self.p2)[0]['id'])
  r=self.report(key='restock');self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(self.report(key='restock').stdout,r.stdout)
  self.assertIn('CONFLICT',self.report().stderr)
  self.assertEqual(items(self.p2)[0]['value'],'low')
  self.assertEqual(scalar(f"select count(*) from house_item_reports where item_id='{self.item}';"),'1')
  self.assertIn('NOT_FOUND',self.report(sub=self.other).stderr)
  self.assertIn('NOT_FOUND',self.report(sub=self.cleaner).stderr)
 def test_room_item_does_not_leak(self):
  item=scalar(f"insert into house_items(house_id,property_id,kind,category,name) values('{self.house}','{self.p2}','maintenance','Bedroom','Keypad') returning id;")
  self.assertNotIn(item,scalar(f"select bloom_house_items('{self.p}');",self.owner))
 def test_concurrent_updates_only_one_wins(self):
  with concurrent.futures.ThreadPoolExecutor(2) as pool:r=list(pool.map(lambda _:self.report(),range(2)))
  self.assertEqual(sum(x.returncode==0 for x in r),1)
  self.assertEqual(scalar(f"select count(*) from house_item_reports where item_id='{self.item}';"),'1')
 def test_block_legacy_room_jobs_activation_and_calendar(self):
  self.assertIn('REVIEW_REQUIRED',self.action(action='activate').stderr)
  r=sql(f"insert into jobs(property_id,checkout_date,start_at,end_at,timezone_snapshot,solo_rate_cents_snapshot) values('{self.p}','2027-01-01','2027-01-01 16:00Z','2027-01-01 20:00Z','America/Detroit',4500);",ok=False)
  self.assertIn('REVIEW_REQUIRED',r.stderr)
  self.assertEqual(scalar(f"select count(*) from jobs where property_id='{self.p}';"),'0')
 def test_discard_and_replay(self):
  r=self.action(action='discard',key='discard');self.assertEqual(r.returncode,0,r.stderr)
  self.assertEqual(self.action(action='discard',key='discard').stdout,r.stdout)
  # Discard receipt replay must work even after soft deletion.
  self.assertEqual(len(self.drafts()),1)
 def test_create_incomplete_draft_is_retry_safe(self):
  q=f"select bloom_listing_draft_create('{CITY}','entire_home','{{}}','new-draft');"
  r=sql(q,self.owner);self.assertEqual(sql(q,self.owner).stdout,r.stdout)
  pid=json.loads(r.stdout)['id'];self.assertEqual(scalar(f"select active from properties where id='{pid}';"),'f')
  self.assertIn('FORBIDDEN',sql(q,self.cleaner,ok=False).stderr)
 def test_entire_home_activation_requires_setup_and_replays(self):
  pid=json.loads(scalar(f"select bloom_listing_draft_create('{CITY}','entire_home','{{}}','home');",self.owner))['id']
  q=f"select bloom_listing_drafts('{pid}','activate',null,0,'activate');"
  self.assertIn('VALIDATION_ERROR',sql(q,self.owner,ok=False).stderr)
  sql(f"update properties set name='Entire apartment',address='Confirmed',cleaning_config='{{}}',draft_data='{{\"instructions\":\"Owner instructions\"}}' where id='{pid}';")
  r=sql(q,self.owner);self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(sql(q,self.owner).stdout,r.stdout)
  self.assertEqual(scalar(f"select active from properties where id='{pid}';"),'t')
  self.assertEqual(scalar(f"select count(*) from jobs where property_id='{pid}';"),'0')
 def test_room_only_item_creation_and_space_setup_are_isolated(self):
  shared=scalar(f"insert into house_spaces(house_id,kind,label) values('{self.house}','kitchen','Kitchen') returning id;")
  private=scalar(f"insert into house_spaces(house_id,property_id,kind,label) values('{self.house}','{self.p}','bedroom','DH1') returning id;")
  q=f"select bloom_house_items('{self.p}',null,'add_room_supply','Room towels',null,null,'add-room-stock');"
  r=sql(q,self.owner,ok=False);self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(sql(q,self.owner).stdout,r.stdout);item=json.loads(r.stdout)['id']
  self.assertNotIn(item,scalar(f"select bloom_house_items('{self.p2}');",self.owner))
  spaces=json.loads(scalar(f"select bloom_room_spaces('{self.p}');",self.owner));self.assertEqual(len(spaces),2)
  payload=json.dumps([{'id':sp['id'],'label':sp['label'],'revision':sp['revision']} for sp in spaces])
  r=sql(f"select bloom_room_spaces('{self.p}','{payload}','save-spaces');",self.owner,ok=False);self.assertEqual(r.returncode,0,r.stderr)
  self.assertIn(private,scalar(f"select cleaning_config from properties where id='{self.p}';"))
  self.assertIn('NOT_FOUND',sql(f"select bloom_room_spaces('{self.p}');",self.other,ok=False).stderr)
  self.assertEqual(scalar(f"select count(*) from house_item_reports where item_id='{item}';"),'0')
 def test_drafts_excluded_from_performance(self):
  r=json.loads(scalar("select bloom_owner_analytics('2026-11-01','2026-11-30');",self.owner))
  self.assertEqual(r['properties'],[])

if __name__=='__main__':unittest.main(verbosity=2)
