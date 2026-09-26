"""PostgreSQL inbox integration with synthetic verified JWT claims, no delivery."""
import json
import unittest
from test_database import make_user,make_job,scalar,sql

class TeamInbox(unittest.TestCase):
    def setUp(self):
        self.admin,self.aid=make_user('admin')
        self.owner,self.oid=make_user('owner')
        self.other,self.otherid=make_user('owner')
        self.cleaner,self.cid=make_user()
        self.replacement,self.rid=make_user()
        self.job,self.prop=make_job()
        sql(f"insert into public.property_owners values('{self.prop}','{self.oid}'); update public.jobs set cleaning_management='private',payer_owner_id='{self.oid}',private_total_cents_snapshot=9000,staffing_capacity=1 where id='{self.job}'; insert into private.property_cleaner_members(property_id,cleaner_id) values('{self.prop}','{self.cid}'),('{self.prop}','{self.rid}');")
    def items(self,subject):
        items=[]
        offset=0
        while True:
            page=json.loads(scalar(f'select public.bloom_notification_inbox({offset});',subject))
            items.extend(page['items'])
            offset+=len(page['items'])
            if offset>=page['total'] or not page['items']:
                return items
    def keys(self,subject):return {x['id'] for x in self.items(subject)}
    def assign(self,cleaner):
        return scalar(f"insert into public.assignments(job_id,cleaner_id,slot) values('{self.job}','{cleaner}',1) returning id;")
    def test_request_lifecycle_and_isolation(self):
        sql(f"update public.properties set bloom_request_status='pending' where id='{self.prop}';update public.jobs set bloom_coverage_requested=true where id='{self.job}';")
        expected={f'management-property:{self.prop}',f'management-job:{self.job}'}
        self.assertTrue(expected<=self.keys(self.admin))
        self.assertFalse(expected & self.keys(self.owner))
        self.assertFalse(expected & self.keys(self.cleaner))
        sql(f"update public.properties set bloom_request_status='accepted' where id='{self.prop}';update public.jobs set bloom_coverage_requested=false where id='{self.job}';")
        self.assertFalse(expected & self.keys(self.admin))
    def test_assign_withdraw_replace_and_dismiss(self):
        staffing=f'staffing:{self.job}'
        self.assertIn(staffing,self.keys(self.owner))
        self.assertNotIn(staffing,self.keys(self.other))
        assignment=self.assign(self.cid)
        self.assertNotIn(staffing,self.keys(self.owner))
        key=f'assignment:{assignment}'
        self.assertIn(key,self.keys(self.cleaner))
        self.assertNotIn(key,self.keys(self.replacement))
        sql(f"select public.bloom_notification_dismiss('{key}');",self.cleaner)
        self.assertNotIn(key,self.keys(self.cleaner))
        sql(f"update public.assignments set ended_at=now(),end_reason='withdrawn',withdrawal_comment='Cannot attend' where id='{assignment}';")
        self.assertIn(staffing,self.keys(self.owner))
        self.assertIn('Cannot attend',next(x['body'] for x in self.items(self.owner) if x['id']==staffing))
        replacement=self.assign(self.rid)
        self.assertNotIn(staffing,self.keys(self.owner))
        self.assertIn(f'assignment:{replacement}',self.keys(self.replacement))
        sql(f"update public.jobs set status='completed',completed_at=now(),completed_by='{self.rid}' where id='{self.job}';")
        self.assertNotIn(f'assignment:{replacement}',self.keys(self.replacement))
        self.assertNotIn(staffing,self.keys(self.owner))
    def test_private_pricing_not_bloom_obligation(self):
        sql(f"update public.properties set cleaning_management='private',cleaner_pricing_set=false where id='{self.prop}';")
        self.assertNotIn(f'pricing:{self.prop}',self.keys(self.admin))

    def test_stale_events_filtered_and_resolution_live(self):
        assignment=self.assign(self.cid)
        sql(f"select private.team_notice('{self.prop}','{self.job}','You have been assigned a private cleaning.','{self.cid}');select private.team_notice('{self.prop}','{self.job}','Your cleaning needs additional team members.');update public.assignments set needs_resolution=true where id='{assignment}';")
        cleaner=[x for x in self.items(self.cleaner) if x['id'].startswith(('team:','assignment:'))]
        self.assertEqual(len(cleaner),1)
        self.assertIn(f'staffing:{self.job}',self.keys(self.owner))
        sql(f"update public.assignments set ended_at=now(),end_reason='reassigned' where id='{assignment}';")
        self.assertFalse({x for x in self.keys(self.cleaner) if x.startswith(('team:','assignment:'))})
        self.assign(self.rid)
        self.assertNotIn(f'staffing:{self.job}',self.keys(self.owner))
        for signature in ['private.inbox_items()','private.inbox_items_before_team_requests()']:
            self.assertEqual(scalar(f"select has_function_privilege('authenticated','{signature}','execute');"),'f')

if __name__=='__main__':unittest.main(verbosity=2)
