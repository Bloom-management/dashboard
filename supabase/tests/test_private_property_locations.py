"""Registered inactive cities and immutable creator payer; real PG/synthetic JWTs."""
import json,unittest,uuid
from test_database import sql,scalar,make_user,CITY
class PrivateLocations(unittest.TestCase):
 def test_creator_is_payer_after_another_owner_joins(self):
  owner,oid=make_user('owner');other,other_id=make_user('owner')
  body=dict(name='Private payer fixture',address='Synthetic address',cityId=CITY,timezone='America/Detroit',bedroomCount=0,bathroomCount=0)
  result=json.loads(scalar(f"select bloom_owner_listing_create('{json.dumps(body)}','create');",owner));pid=result['listing']['id']
  self.assertEqual(scalar(f"select private_payer_id from properties where id='{pid}';"),oid)
  sql(f"insert into property_owners(property_id,owner_id) values('{pid}','{other_id}');")
  job=scalar(f"insert into jobs(property_id,checkout_date,start_at,end_at,timezone_snapshot,solo_rate_cents_snapshot) values('{pid}',current_date,(current_date+time '11:00') at time zone 'America/Detroit',(current_date+time '15:00') at time zone 'America/Detroit','America/Detroit',7500) returning id;")
  self.assertEqual(scalar(f"select payer_owner_id from jobs where id='{job}';"),oid)
  self.assertEqual(scalar(f"select cleaning_management from jobs where id='{job}';"),'private')
 def test_private_listing_in_registered_inactive_city_does_not_activate_network(self):
  owner,oid=make_user('owner');cleaner,cid=make_user()
  city=scalar(f"insert into cities(name,active,notification_timezone) values('Outside test {uuid.uuid4()}',false,'America/Detroit') returning id;")
  self.assertIn(city,scalar('select bloom_owner_property_cities();',owner))
  self.assertNotEqual(sql('select bloom_owner_property_cities();',cleaner,ok=False).returncode,0)
  body=dict(name='Outside Bloom area',address='Synthetic address',cityId=city,timezone='America/Detroit',bedroomCount=0,bathroomCount=0)
  pid=json.loads(scalar(f"select bloom_owner_listing_create('{json.dumps(body)}','create');",owner))['listing']['id']
  response=json.loads(scalar(f"select bloom_property_team_action('{pid}','request_bloom','{{\"enabled\":true}}','request');",owner))
  self.assertEqual(response['management'],'private');self.assertEqual(response['requestStatus'],'pending')
  self.assertEqual(scalar(f"select active from cities where id='{city}';"),'f')
if __name__=='__main__':unittest.main(verbosity=2)
