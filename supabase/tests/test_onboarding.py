"""Atomic onboarding and API-independent authorization in disposable PostgreSQL."""
import concurrent.futures
import json
import unittest
import uuid
from test_database import sql,scalar,make_user,CITY
from test_calendar_database import rpc,data
class Onboarding(unittest.TestCase):
 def complete(self,sub,role='owner',key='finish',**overrides):
  args=dict(p_subject=sub,p_role=role,p_city=CITY if role=='cleaner' else None,p_home_base='Detroit' if role=='owner' else None,p_name='Synthetic Onboarding',p_primary_email=None,p_key=key);args.update(overrides)
  return rpc('bloom_complete_onboarding',args,ok=False)
 def test_legacy_grandfathering_does_not_make_new_inserts_complete(self):
  for sub in ['onboarding_legacy_owner','onboarding_legacy_admin','onboarding_legacy_cleaner']:
   self.assertTrue(json.loads(scalar('select bloom_onboarding_profile();',sub))['complete'])
  self.assertFalse(json.loads(scalar('select bloom_onboarding_profile();','onboarding_legacy_partial'))['complete'])
 def test_new_unmapped_atomic_owner_without_city_or_property(self):
  sub='newowner_'+uuid.uuid4().hex
  self.assertEqual(scalar(f"select count(*) from users where clerk_user_id='{sub}';"),'0')
  result=self.complete(sub);self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(data(result),dict(status='complete',role='owner',destination='/owner'))
  profile=json.loads(scalar('select bloom_onboarding_profile();',sub));self.assertTrue(profile['complete']);self.assertEqual(profile['homeBase'],'Detroit');self.assertIsNone(profile['cityId']);self.assertEqual(profile['assignedPropertyCount'],0)
  self.assertEqual(self.complete(sub).stdout,result.stdout)
  self.assertIn('CONFLICT',self.complete(sub,p_home_base='Chicago').stderr)
  self.assertIn('CONFLICT',self.complete(sub,role='cleaner',key='other').stderr)
 def test_incomplete_mapped_user_blocked_until_completion_and_no_old_rpc_bypass(self):
  sub='partial_'+uuid.uuid4().hex
  scalar(f"insert into users(clerk_user_id,role) values('{sub}','owner') returning id;")
  self.assertFalse(json.loads(scalar('select bloom_onboarding_profile();',sub))['complete'])
  self.assertIn('INVALID_STATE',sql('select bloom_owner_listings(null);',sub,ok=False).stderr)
  self.assertIn('INVALID_STATE',sql('select bloom_me();',sub,ok=False).stderr)
  self.assertIn('INVALID_STATE',sql(f"select bloom_onboard('{CITY}','bypass');",sub,ok=False).stderr)
  self.assertEqual(scalar('select count(*) from users;',sub),'0')
  self.assertNotEqual(rpc('bloom_complete_onboarding',dict(p_subject=sub,p_role='owner',p_city=None,p_home_base='Detroit',p_name='Name',p_primary_email=None,p_key='bad'),subject=sub,role='authenticated',ok=False).returncode,0)
  self.assertEqual(self.complete(sub).returncode,0)
  self.assertEqual(json.loads(scalar('select bloom_me();',sub))['role'],'owner')
 def test_cleaner_city_race_replay_and_missing_city_rollback(self):
  sub='cleaner_'+uuid.uuid4().hex
  self.assertIn('VALIDATION_ERROR',self.complete(sub,'cleaner',p_city=str(uuid.uuid4())).stderr)
  self.assertEqual(scalar(f"select count(*) from users where clerk_user_id='{sub}';"),'0')
  with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda _:self.complete(sub,'cleaner'),range(2)))
  self.assertTrue(all(r.returncode==0 for r in results),[r.stderr for r in results]);self.assertEqual(results[0].stdout,results[1].stdout)
  profile=json.loads(scalar('select bloom_onboarding_profile();',sub));self.assertEqual(profile['cityId'],CITY);self.assertIsNone(profile['homeBase']);self.assertTrue(profile['complete'])
 def test_pending_owner_binding_and_admin_service_only(self):
  admin,aid=make_user('admin');email=uuid.uuid4().hex+'@example.invalid';sub='pending_'+uuid.uuid4().hex
  body=dict(cityId=CITY,name='Onboarding fixture',timezone='America/Detroit',address='Synthetic address',instructions='Synthetic notes',isBloomOwned=False,soloRateCents=7500,ownerIds=[],pendingOwnerEmail=email)
  prop=json.loads(scalar("select bloom_admin_property('"+json.dumps(body)+"','fixture');",admin))['id']
  self.assertEqual(self.complete(sub,p_primary_email=email).returncode,0)
  self.assertEqual(scalar(f"select count(*) from property_owners po join users u on u.id=po.owner_id where po.property_id='{prop}' and u.clerk_user_id='{sub}';"),'1')
  other='admin_'+uuid.uuid4().hex
  self.assertNotEqual(rpc('bloom_provision_invited_admin',dict(p_subject=other,p_name='Admin'),subject=sub,role='authenticated',ok=False).returncode,0)
  self.assertEqual(rpc('bloom_provision_invited_admin',dict(p_subject=other,p_name='Admin')).returncode,0)
  self.assertTrue(json.loads(scalar('select bloom_onboarding_profile();',other))['complete'])
  self.assertIn('CONFLICT',rpc('bloom_provision_invited_admin',dict(p_subject=sub,p_name='No promote'),ok=False).stderr)

if __name__=='__main__':unittest.main(verbosity=2)
