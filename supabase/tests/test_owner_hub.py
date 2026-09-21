"""Owner projections and owner service RPCs against disposable PostgreSQL."""
import json
import unittest
import uuid
from test_database import sql,scalar,make_user,CITY
from test_calendar_database import source,rpc,data,event,snapshot

class OwnerHub(unittest.TestCase):
 def setUp(self):
  self.owner,self.oid=make_user('owner');self.other,self.otherid=make_user('owner')
  self.admin,self.aid=make_user('admin');self.cleaner,self.cid=make_user()
  _,self.prop,self.sid,self.input=source(actor=self.aid)
  _,self.foreign,self.foreignsid,_=source(actor=self.aid)
  sql(f"insert into property_owners values('{self.prop}','{self.oid}'),('{self.foreign}','{self.otherid}');")
 def owner_rpc(self,name,**kw):
  return rpc('bloom_owner_calendar_'+name,dict(p_actor=self.oid,p_property=self.prop,**kw),ok=False)
 def test_listings_safe_supplies_latest_completed_only(self):
  first,never,removed=[str(uuid.uuid4()) for _ in range(3)]
  config=json.dumps(dict(version=1,rooms=[],supplies=[dict(id=first,name='Soap'),dict(id=never,name='Paper')]))
  sql(f"update properties set cleaning_config='{config}' where id='{self.prop}';")
  for i,status,level in [(1,'completed','low'),(2,'completed','full'),(3,'open','empty')]:
   completed=f",completed_at,completed_by" if status=='completed' else ''
   values=f",'2025-01-0{i} 16:00+00','{self.cid}'" if status=='completed' else ''
   jid=scalar(f"insert into jobs(property_id,checkout_date,start_at,end_at,timezone_snapshot,solo_rate_cents_snapshot,status{completed}) values('{self.prop}','2025-01-0{i}','2025-01-0{i} 16:00+00','2025-01-0{i} 20:00+00','America/Detroit',7500,'{status}'{values}) returning id;")
   sql(f"insert into job_supply_reports values('{jid}','{first}','Historical soap','{level}','{self.cid}','2025-01-0{i} 16:00+00'),('{jid}','{removed}','Removed supply','low','{self.cid}','2025-01-0{i} 16:00+00');")
  page=json.loads(scalar('select bloom_owner_listings(null);',self.owner));self.assertEqual(len(page['items']),1)
  item=page['items'][0];self.assertEqual(item['id'],self.prop);self.assertIsNone(item['nightlyGuestRateCents']);self.assertIsNone(item['hostPayoutCents'])
  self.assertEqual(set(item),{'id','name','timezone','active','supplies','nightlyGuestRateCents','hostPayoutCents','currency','sources','setupRequired','bedroomCount','bathroomCount','maintenance'})
  self.assertEqual(item['supplies'][0]['level'],'full');self.assertEqual(item['supplies'][0]['name'],'Soap');self.assertIsNotNone(item['supplies'][0]['reportedAt'])
  self.assertEqual(item['supplies'][1]['level'],None);self.assertEqual(len(item['supplies']),2)
  text=json.dumps(page);self.assertNotIn(self.cid,text);self.assertNotIn('encryptedUrl',text);self.assertNotIn('errorCode',text)
  self.assertEqual(json.loads(scalar('select bloom_owner_listings(null);',self.other))['items'][0]['id'],self.foreign)
  for subject in [self.admin,self.cleaner]:self.assertIn('FORBIDDEN',sql('select bloom_owner_listings(null);',subject,ok=False).stderr)
 def test_analytics_unknown_coverage_positive_origin_and_foreign_scope(self):
  begin=data(self.owner_rpc('begin_sync',p_source=self.sid,p_key='analytics'))
  events=[event(),event(uid='block',start='2030-06-01',end='2030-06-02',kind='unknown',evidence='unverified',reviewRequired=True)]
  self.assertEqual(self.owner_rpc('finish_sync',p_source=self.sid,p_run=begin['runId'],p_version=begin['version'],p_snapshot=snapshot(events),p_validators={}).returncode,0)
  query="select bloom_owner_analytics('2030-01-01','2031-01-01',null);"
  result=json.loads(scalar(query,self.owner));self.assertEqual(len(result['properties']),1);self.assertEqual(result['properties'][0]['coverage'],[])
  self.assertEqual(len(result['events']),2);self.assertEqual({x['origin'] for x in result['events']},{'airbnb','unknown'})
  self.assertNotIn('sourceId',json.dumps(result));self.assertNotIn('synthetic-event',json.dumps(result))
  self.assertIn('NOT_FOUND',sql(f"select bloom_owner_analytics('2030-01-01','2030-02-01',array['{self.foreign}'::uuid]);",self.owner,ok=False).stderr)
  self.assertIn('VALIDATION_ERROR',sql("select bloom_owner_analytics('2030-01-01','2032-01-01',null);",self.owner,ok=False).stderr)
  self.assertIn('FORBIDDEN',sql(query,self.cleaner,ok=False).stderr)
 def test_same_day_arrivals_at_range_start_are_projected_without_extra_nights(self):
  lease=data(self.owner_rpc('begin_sync',p_source=self.sid,p_key='same-day'))
  events=[event(uid='same-day-start',start='2030-05-01',end='2030-05-01'),event(uid='before-range',start='2030-04-30',end='2030-04-30'),event(uid='exclusive-end',start='2030-05-02',end='2030-05-02')]
  result=self.owner_rpc('finish_sync',p_source=self.sid,p_run=lease['runId'],p_version=lease['version'],p_snapshot=snapshot(events),p_validators={})
  self.assertEqual(result.returncode,0,result.stderr)
  projection=json.loads(scalar("select bloom_owner_analytics('2030-05-01','2030-05-02',null);",self.owner))
  self.assertEqual(len(projection['events']),1)
  observed=projection['events'][0];self.assertTrue(observed['confirmed']);self.assertEqual(observed['startDate'],'2030-05-01');self.assertEqual(observed['endDate'],observed['startDate'])
 def test_listing_pagination_and_oversized_portfolio_require_selection(self):
  sql(f"with p as (insert into properties(city_id,name,address) select '{CITY}','Isolated owner page '||n,'Fixture' from generate_series(1,101) n returning id) insert into property_owners select id,'{self.oid}' from p;")
  first=json.loads(scalar('select bloom_owner_listings(null);',self.owner));self.assertEqual(len(first['items']),100)
  last=json.loads(scalar(f"select bloom_owner_listings('{first['nextCursor']}');",self.owner));self.assertEqual(len(last['items']),2);self.assertIsNone(last['nextCursor'])
  self.assertEqual(len({x['id'] for x in first['items']+last['items']}),102)
  self.assertIn('VALIDATION_ERROR',sql("select bloom_owner_analytics('2030-01-01','2030-02-01',null);",self.owner,ok=False).stderr)
  selected=json.loads(scalar(f"select bloom_owner_analytics('2030-01-01','2030-02-01',array['{self.prop}'::uuid]);",self.owner));self.assertEqual(len(selected['properties']),1)
 def test_owner_sources_setup_binding_revocation_and_existing_admin_gate(self):
  result=self.owner_rpc('add_source',p_input=self.input,p_key='owner-source');self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(data(result)['id'],self.sid)
  self.assertEqual(data(self.owner_rpc('sources',p_cursor=None))['items'][0]['id'],self.sid)
  second=self.owner_rpc('add_source',p_input={**self.input,'fingerprint':'e'*64},p_key='different-export');self.assertEqual(second.returncode,0,second.stderr);self.assertNotEqual(data(second)['id'],self.sid)
  replay=self.owner_rpc('add_source',p_input={**self.input,'fingerprint':'e'*64},p_key='different-export');self.assertEqual(data(replay)['id'],data(second)['id'])
  sql(f"update calendar_sources set enabled=false where id='{self.sid}';")
  third=self.owner_rpc('add_source',p_input={**self.input,'fingerprint':'f'*64},p_key='disabled-other-export');self.assertEqual(third.returncode,0,third.stderr);self.assertNotEqual(data(third)['id'],self.sid)
  rotated=self.owner_rpc('add_source',p_input={**self.input,'urlDigest':'e'*64},p_key='rotate-disabled');self.assertEqual(rotated.returncode,0,rotated.stderr);self.assertFalse(data(rotated)['enabled']);self.assertEqual(data(rotated)['id'],self.sid)
  sql(f"update calendar_sources set enabled=true where id='{self.sid}';")
  vrbo_added=self.owner_rpc('add_source',p_input={**self.input,'provider':'vrbo'},p_key='vrbo');self.assertEqual(vrbo_added.returncode,0,vrbo_added.stderr)
  self.assertIn('VALIDATION_ERROR',self.owner_rpc('add_source',p_input={**self.input,'provider':'other'},p_key='unsupported-provider').stderr)
  self.assertIn('VALIDATION_ERROR',self.owner_rpc('add_source',p_input={**self.input,'propertyId':self.foreign},p_key='foreign').stderr)
  self.assertIn('NOT_FOUND',self.owner_rpc('begin_sync',p_source=self.foreignsid,p_key='cross-source').stderr)
  _,_,vrbo,_=source(actor=self.aid,prop=self.prop,provider='vrbo')
  vrbo_lease=self.owner_rpc('begin_sync',p_source=vrbo,p_key='vrbo-sync');self.assertEqual(vrbo_lease.returncode,0,vrbo_lease.stderr)
  self.assertIn('FORBIDDEN',rpc('bloom_calendar_begin_sync',dict(p_actor=self.oid,p_source=self.sid,p_key='old-admin-rpc'),ok=False).stderr)
  args=dict(p_actor=self.oid,p_property=self.prop,p_cursor=None)
  for role in ['authenticated','anon']:
   self.assertNotEqual(rpc('bloom_owner_calendar_sources',args,ok=False,subject=self.owner,role=role).returncode,0)
  lease=data(self.owner_rpc('begin_sync',p_source=self.sid,p_key='lease'))
  sql(f"delete from property_owners where property_id='{self.prop}' and owner_id='{self.oid}';")
  common=dict(p_source=self.sid,p_run=lease['runId'],p_version=lease['version'])
  self.assertIn('NOT_FOUND',self.owner_rpc('finish_sync',**common,p_snapshot=snapshot([event()]),p_validators={}).stderr)
  self.assertIn('NOT_FOUND',self.owner_rpc('fail_sync',**common,p_code='FETCH_FAILED').stderr)
  self.assertIn('NOT_FOUND',self.owner_rpc('sources',p_cursor=None).stderr)
  self.assertEqual(scalar(f"select count(*) from calendar_events where source_id='{self.sid}';"),'0')
  self.assertEqual(scalar(f"select status from calendar_sync_runs where id='{lease['runId']}';"),'running')
 def test_owner_finish_replay_and_fail_are_actor_bound(self):
  lease=data(self.owner_rpc('begin_sync',p_source=self.sid,p_key='lease'))
  args=dict(p_source=self.sid,p_run=lease['runId'],p_version=lease['version'],p_snapshot=snapshot([event()]),p_validators={})
  result=self.owner_rpc('finish_sync',**args);self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(self.owner_rpc('finish_sync',**args).stdout,result.stdout)
  self.assertEqual(scalar(f"select count(*) from jobs where property_id='{self.prop}';"),'1')
  sql(f"insert into property_owners values('{self.prop}','{self.otherid}');")
  changed=dict(p_actor=self.otherid,p_property=self.prop,**args)
  self.assertIn('FORBIDDEN',rpc('bloom_owner_calendar_finish_sync',changed,ok=False).stderr)

if __name__=='__main__':unittest.main(verbosity=2)
