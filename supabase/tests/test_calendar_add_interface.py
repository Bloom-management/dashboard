"""Real transactional SQL tests for the shared Owner/Admin calendar interface.
Uses only the disposable cluster, never hosted services or real bookings.
"""
import concurrent.futures
import json
import unittest
import uuid
from test_database import sql, scalar, make_user, CITY

class CalendarAddInterface(unittest.TestCase):
    def setUp(self):
        self.owner,self.owner_id=make_user('owner')
        self.other,_=make_user('owner')
        self.admin,self.admin_id=make_user('admin')
        self.cleaner,self.cleaner_id=make_user()
        self.prop=scalar(f"insert into public.properties(city_id,name,address,cleaning_management,private_payer_id) values('{CITY}','Calendar interface fixture','Synthetic','private','{self.owner_id}') returning id;")
        sql(f"insert into public.property_owners values('{self.prop}','{self.owner_id}');insert into private.property_cleaner_members(property_id,cleaner_id,default_assigned) values('{self.prop}','{self.cleaner_id}',false);")
        self.day=scalar('select current_date+30;')
    def rpc(self,name,args,subject=None):
        encoded=','.join("'"+json.dumps(a).replace("'","''")+"'::jsonb" if isinstance(a,dict) else "'"+str(a).replace("'","''")+"'" for a in args)
        return json.loads(scalar(f'select public.{name}({encoded});',subject or self.owner))
    def draft(self,**overrides):
        return dict(kind='cleaning',propertyId=self.prop,action='create',date=self.day,startTime='11:00',endTime='15:00',comments='Kitchen needs attention',management='private',capacity=1,totalCents=9000,cleaners=[],inStayAcknowledged=False,assignedImpactAcknowledged=False,additionalAcknowledged=False,**overrides)
    def review(self,draft,subject=None):
        return dict(draft,**self.rpc('bloom_calendar_add_review',[draft],subject))
    def save(self,draft,subject=None,key=None):
        return self.rpc('bloom_calendar_add',[draft,key or uuid.uuid4().hex],subject)
    def test_private_create_real_defaults_read_and_idempotency(self):
        options=self.rpc('bloom_calendar_add_options',[])
        prop=next(x for x in options['properties'] if x['id']==self.prop)
        self.assertEqual(prop['management'],'private');self.assertTrue(prop['canEditPrivateCompensation'])
        draft=self.draft();draft['cleaners']=[dict(id=self.cleaner_id,individualAmountCents=None)]
        draft=self.review(draft);first=self.save(draft,key='same');self.assertEqual(self.save(draft,key='same'),first)
        self.assertEqual(first['status'],'created')
        self.assertEqual(scalar(f"select job_instructions from public.jobs where id='{first['cleaningId']}';"),'Kitchen needs attention')
        self.assertEqual(scalar(f"select count(*) from public.assignments where job_id='{first['cleaningId']}' and ended_at is null;"),'1')
        self.assertEqual(scalar(f"select private_total_cents from public.properties where id='{self.prop}';"),'9000')
        availability=self.rpc('bloom_calendar_add_availability',[self.prop,self.day,self.day])
        self.assertEqual(availability['cleanings'][0]['id'],first['cleaningId'])
    def test_scope_and_private_helpers_denied(self):
        body=json.dumps(self.draft())
        self.assertIn('FORBIDDEN',sql(f"select public.bloom_calendar_add_review('{body}');",self.cleaner,ok=False).stderr)
        self.assertIn('NOT_FOUND',sql(f"select public.bloom_calendar_add_availability('{self.prop}','{self.day}','{self.day}');",self.other,ok=False).stderr)
        self.assertIn('permission denied',sql(f"select * from private.manual_bookings;",self.owner,ok=False).stderr)
    def test_booking_boundaries_overlap_and_checkout_reuse(self):
        checkout=scalar(f"select '{self.day}'::date+3;")
        booking=dict(kind='booking',propertyId=self.prop,checkIn=self.day,checkout=checkout,note='Internal',checkoutResolution=dict(action='create'))
        first=self.save(self.review(booking));self.assertIn('bookingId',first)
        adjacent=dict(booking,checkIn=checkout,checkout=scalar(f"select '{checkout}'::date+2;"))
        self.assertEqual(self.save(self.review(adjacent))['status'],'created')
        overlap=dict(booking,checkout=scalar(f"select '{checkout}'::date+1;"))
        self.assertEqual(self.save(self.review(overlap))['code'],'occupied')
        # No new booking or cleaning was inserted for the rejected overlapping range.
        self.assertEqual(scalar(f"select count(*) from private.manual_bookings where property_id='{self.prop}';"),'2')
    def test_stale_review_preserves_no_partial_write(self):
        draft=self.review(self.draft())
        sql(f"update public.properties set private_total_cents=10000 where id='{self.prop}';")
        result=self.save(draft);self.assertEqual(result['status'],'conflict')
        self.assertEqual(scalar(f"select count(*) from public.jobs where property_id='{self.prop}';"),'0')
        self.assertEqual(self.save(self.review(self.draft()))['status'],'created')
    def test_additional_move_and_assigned_impact(self):
        draft=self.draft();draft['cleaners']=[dict(id=self.cleaner_id,individualAmountCents=None)]
        job=self.save(self.review(draft))['cleaningId']
        extra=self.save(self.review(self.draft()));self.assertEqual(extra['code'],'existing_cleaning')
        additional=self.draft();additional['additionalAcknowledged']=True
        self.assertEqual(self.save(self.review(additional))['status'],'created')
        move=dict(draft,action='move',existingCleaningId=job,expectedVersion=1,date=scalar(f"select '{self.day}'::date+1;"))
        self.assertEqual(self.save(self.review(move))['code'],'assigned_impact')
        move['assignedImpactAcknowledged']=True
        result=self.save(self.review(move));self.assertEqual(result['status'],'moved')
        self.assertEqual(scalar(f"select needs_resolution from public.assignments where job_id='{job}' and ended_at is null;"),'t')
    def test_bloom_admin_staffing_and_owner_request(self):
        sql(f"update public.properties set bloom_approved=true where id='{self.prop}';")
        draft=self.draft();draft.update(management='bloom',cleaners=[dict(id=self.cleaner_id,individualAmountCents=None)])
        result=self.save(self.review(draft,self.admin),self.admin)
        self.assertEqual(scalar(f"select count(*) from public.assignments where job_id='{result['cleaningId']}';"),'1')
        sql(f"update public.properties set bloom_approved=false where id='{self.prop}';")
        draft.update(date=scalar(f"select '{self.day}'::date+1;"),cleaners=[])
        result=self.save(self.review(draft));self.assertEqual(result['status'],'requested')
        self.assertEqual(scalar(f"select cleaning_management from public.properties where id='{self.prop}';"),'private')
    def test_reuse_checkout_explicit_assignment_ack_and_projection(self):
        cleaning=self.draft();cleaning['cleaners']=[dict(id=self.cleaner_id,individualAmountCents=None)]
        job=self.save(self.review(cleaning))['cleaningId']
        booking=dict(kind='booking',propertyId=self.prop,checkIn=scalar(f"select '{self.day}'::date-2;"),checkout=self.day,note='',checkoutResolution=dict(action='create'))
        self.assertEqual(self.save(self.review(booking))['code'],'existing_cleaning')
        availability=self.rpc('bloom_calendar_add_availability',[self.prop,self.day,self.day])
        self.assertTrue(availability['cleanings'][0]['eligibleForCheckout'])
        booking['checkoutResolution']=dict(action='reuse',cleaningId=job,expectedVersion=1)
        self.assertEqual(self.save(self.review(booking))['code'],'assigned_impact')
        booking['assignedImpactAcknowledged']=True
        result=self.save(self.review(booking));self.assertEqual(result['cleaningId'],job)
        self.assertEqual(scalar(f"select count(*) from public.jobs where property_id='{self.prop}';"),'1')
        blocks=self.rpc('bloom_owner_calendar',[booking['checkIn'],self.day])
        self.assertEqual(blocks[0]['bookingId'],result['bookingId']);self.assertEqual(blocks[0]['providers'],['manual'])
        jobs=self.rpc('bloom_calendar_add_cleanings',[self.day,self.day]);self.assertEqual(jobs[0]['id'],job)
        self.assertFalse(jobs[0]['eligibleForCheckout'])
    def test_in_stay_ack_and_move_with_different_listing_default(self):
        end=scalar(f"select '{self.day}'::date+3;")
        booking=dict(kind='booking',propertyId=self.prop,checkIn=self.day,checkout=end,note='',checkoutResolution=dict(action='create'))
        self.save(self.review(booking))
        cleaning=self.draft();cleaning['date']=scalar(f"select '{self.day}'::date+1;")
        self.assertEqual(self.save(self.review(cleaning))['code'],'in_stay')
        cleaning.update(inStayAcknowledged=True,additionalAcknowledged=True)
        job=self.save(self.review(cleaning))['cleaningId']
        sql(f"update public.properties set cleaning_management='bloom' where id='{self.prop}';")
        move=dict(cleaning,action='move',existingCleaningId=job,expectedVersion=1,date=scalar(f"select '{self.day}'::date+4;"),cleaners=[])
        self.assertEqual(self.save(self.review(move))['status'],'moved')
        self.assertEqual(scalar(f"select cleaning_management from public.jobs where id='{job}';"),'private')
    def test_staffing_conflict_is_atomic_and_retry_keeps_comments(self):
        draft=self.draft();draft['cleaners']=[dict(id=self.cleaner_id,individualAmountCents=None)]
        self.save(self.review(draft))
        second=dict(draft,additionalAcknowledged=True,comments='Keep this draft')
        self.assertEqual(self.save(self.review(second))['code'],'staffing')
        self.assertEqual(scalar(f"select count(*) from public.jobs where property_id='{self.prop}';"),'1')
        second['date']=scalar(f"select '{self.day}'::date+1;")
        job=self.save(self.review(second))['cleaningId']
        self.assertEqual(scalar(f"select job_instructions from public.jobs where id='{job}';"),'Keep this draft')

    def test_review_held_cleaning_not_movable_or_reusable(self):
        job=self.save(self.review(self.draft()))['cleaningId']
        sql(f"update public.jobs set review_required=true where id='{job}';")
        draft=dict(self.draft(),action='move',existingCleaningId=job,expectedVersion=1,date=scalar(f"select '{self.day}'::date+1;"))
        self.assertEqual(self.save(self.review(draft))['code'],'cleaning_changed')
        booking=dict(kind='booking',propertyId=self.prop,checkIn=scalar(f"select '{self.day}'::date-2;"),checkout=self.day,note='',checkoutResolution=dict(action='reuse',cleaningId=job,expectedVersion=1))
        self.assertEqual(self.save(self.review(booking))['code'],'cleaning_changed')
        self.assertEqual(scalar(f"select count(*) from private.manual_bookings where property_id='{self.prop}';"),'0')

    def test_zero_night_import_does_not_break_review(self):
        from test_calendar_database import source
        _,_,sid,_=source(actor=self.admin_id,prop=self.prop)
        sql(f"insert into public.calendar_events(source_id,uid,start_local_date,end_local_date,kind,content_hash) values('{sid}','zero-night','{self.day}','{self.day}','unknown','fixture');")
        self.assertIn('reviewToken',self.review(self.draft()))

    def test_concurrent_booking_creates_one(self):
        booking=dict(kind='booking',propertyId=self.prop,checkIn=self.day,checkout=scalar(f"select '{self.day}'::date+2;"),note='',checkoutResolution=dict(action='create'))
        draft=self.review(booking)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:self.save(draft),range(2)))
        self.assertEqual(sum(r['status']=='created' for r in results),1)
        self.assertEqual(scalar(f"select count(*) from private.manual_bookings where property_id='{self.prop}';"),'1')

if __name__=='__main__':unittest.main()
