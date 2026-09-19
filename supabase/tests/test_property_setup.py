"""Disposable PostgreSQL authorization/transaction tests; not Clerk verification."""
import json
import unittest
import uuid
from test_database import sql, scalar, make_user, CITY
from test_calendar_database import source, rpc, data

class PropertySetupTests(unittest.TestCase):
    def setUp(self):
        self.admin,self.admin_id=make_user('admin')
        self.owner,self.owner_id=make_user('owner')
        self.other,self.other_id=make_user('owner')
        self.cleaner,self.cleaner_id=make_user()
        self.body=dict(cityId=CITY,name='LOCAL TEST property',timezone='America/Detroit',address='Synthetic test location',instructions='Synthetic instructions',isBloomOwned=True,soloRateCents=8000,ownerIds=[])
    def create(self,body=None,subject=None,key=None):
        payload=json.dumps(body or self.body).replace("'","''")
        return sql(f"select public.bloom_admin_property('{payload}'::jsonb,'{key or uuid.uuid4().hex}');",subject or self.admin,ok=False)
    def test_atomic_ownership_instructions_and_replay(self):
        first=self.create(key='setup');self.assertEqual(first.returncode,0,first.stderr)
        self.assertEqual(self.create(key='setup').stdout,first.stdout)
        pid=json.loads(first.stdout)['id']
        self.assertEqual(scalar(f"select count(*) from public.property_owners where property_id='{pid}';"),'0')
        self.assertEqual(scalar(f"select instructions from public.property_entry_instructions where property_id='{pid}';"),'Synthetic instructions')
        owned=json.loads(self.create(dict(self.body,isBloomOwned=False,ownerIds=[self.owner_id])).stdout)['id']
        self.assertEqual(scalar(f"select count(*) from public.properties where id='{owned}';",self.owner),'1')
        self.assertEqual(scalar(f"select count(*) from public.properties where id in ('{owned}','{pid}');",self.other),'0')
        self.assertEqual(scalar(f"select count(*) from public.property_entry_instructions where property_id='{owned}';",self.owner),'0')
    def test_invalid_ownership_rate_timezone_and_role_do_not_insert(self):
        before=scalar('select count(*) from public.properties;')
        for body in [dict(self.body,isBloomOwned=False),dict(self.body,ownerIds=[self.owner_id]),dict(self.body,isBloomOwned=False,ownerIds=[self.admin_id]),dict(self.body,soloRateCents=7501),dict(self.body,timezone='Not/AZone'),dict(self.body,instructions='')]:
            result=self.create(body);self.assertNotEqual(result.returncode,0);self.assertIn('VALIDATION_ERROR',result.stderr)
        self.assertIn('FORBIDDEN',self.create(subject=self.cleaner).stderr)
        self.assertEqual(scalar('select count(*) from public.properties;'),before)
    def test_admin_property_read_keeps_rates_private(self):
        pid=json.loads(self.create().stdout)['id']
        result=json.loads(scalar(f"select public.bloom_admin_property_options('{pid}',null);",self.admin))
        self.assertEqual(result['items'][0]['soloRateCents'],8000)
        self.assertEqual(result['items'][0]['instructions'],'Synthetic instructions')
        for sub in [self.cleaner,self.owner]:
            self.assertIn('FORBIDDEN',sql(f"select public.bloom_admin_property_options('{pid}',null);",sub,ok=False).stderr)
            self.assertNotEqual(sql('select solo_rate_cents from public.properties;',sub,ok=False).returncode,0)
    def test_property_source_scope_and_service_authorization(self):
        actor,prop,sid,_=source(actor=self.admin_id)
        _,other,other_sid,_=source(actor=self.admin_id)
        result=data(rpc('bloom_calendar_property_sources',dict(p_actor=actor,p_property=prop,p_cursor=None)))
        self.assertEqual([s['id'] for s in result['items']],[sid]);self.assertNotIn(other_sid,json.dumps(result));self.assertNotIn('encryptedUrl',json.dumps(result))
        result=sql(f"select public.bloom_calendar_property_sources('{actor}','{prop}',null);",self.cleaner,ok=False)
        self.assertNotEqual(result.returncode,0)
        self.assertNotEqual(rpc('bloom_calendar_property_sources',dict(p_actor=self.owner_id,p_property=prop,p_cursor=None),False).returncode,0)

if __name__=='__main__':unittest.main(verbosity=2)
