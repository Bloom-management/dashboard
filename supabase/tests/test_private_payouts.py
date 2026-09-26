"""Real PostgreSQL payout boundaries with simulated verified JWT identities.
No browser, Clerk, real payments or hosted database is used.
"""
import concurrent.futures
import json
import unittest
import uuid
from test_database import make_user, make_job, scalar, sql

class PrivatePayouts(unittest.TestCase):
    def setUp(self):
        self.admin,self.admin_id=make_user('admin')
        self.owner,self.owner_id=make_user('owner')
        self.other,self.other_id=make_user('owner')
        self.cleaner,self.cleaner_id=make_user()
        self.assignments=[]
        for payer,amount in [(None,7500),(self.owner_id,4500),(self.other_id,9000)]:
            job,prop=make_job(day='current_date-2')
            if payer:
                sql(f"update public.jobs set cleaning_management='private',payer_owner_id='{payer}' where id='{job}';")
            assignment=scalar(f"insert into public.assignments(job_id,cleaner_id,slot,completed_pay_cents) values('{job}','{self.cleaner_id}',1,{amount}) returning id;")
            sql(f"update public.jobs set status='completed',completed_at=now(),completed_by='{self.admin_id}' where id='{job}';")
            self.assignments.append(assignment)
    def call(self,subject,action,payload,key=None,admin=False,ok=True):
        function='bloom_admin_payout_action' if admin else 'bloom_owner_payout_action'
        body=json.dumps(payload).replace("'","''")
        return sql(f"select public.{function}('{self.cleaner_id}','{action}','{body}','{key or uuid.uuid4().hex}');",subject,ok=ok)
    def detail(self,subject,admin=False):
        function='bloom_admin_payouts' if admin else 'bloom_owner_payouts'
        return json.loads(scalar(f"select public.{function}('{self.cleaner_id}');",subject))
    def payment(self,assignment,amount):
        return dict(amountCents=amount,method='Cash',paymentDate=scalar('select current_date;'),allocations=[dict(cleaningId=assignment,amountCents=amount)])
    def test_separate_balances_and_cleaner_groups(self):
        self.assertEqual(self.detail(self.admin,True)['totalDueCents'],7500)
        self.assertEqual(self.detail(self.owner)['totalDueCents'],4500)
        self.assertEqual(self.detail(self.other)['totalDueCents'],9000)
        data=json.loads(scalar('select public.bloom_cleaner_payouts();',self.cleaner))
        self.assertEqual(data['totalDueCents'],7500)
        self.assertEqual({x['payerId']:x['detail']['totalDueCents'] for x in data['payers']},{None:7500,self.owner_id:4500,self.other_id:9000})
        self.assertEqual(len(self.detail(self.owner)['cleanings']),1)
    def test_cross_payer_mutations_denied(self):
        for subject,admin,target in [(self.owner,False,0),(self.owner,False,2),(self.admin,True,1)]:
            for action,payload in [('payment',self.payment(self.assignments[target],1)),('adjustment',dict(cleaningId=self.assignments[target],amountCents=1,reason='invalid payer'))]:
                result=self.call(subject,action,payload,admin=admin,ok=False)
                self.assertNotEqual(result.returncode,0)
                self.assertIn('NOT_FOUND',result.stderr)
        stranger,_=make_user('owner')
        denied=sql(f"select public.bloom_owner_payouts('{self.cleaner_id}');",stranger,ok=False)
        self.assertIn('NOT_FOUND',denied.stderr)
        self.assertIn('FORBIDDEN',sql('select public.bloom_owner_payouts();',self.cleaner,ok=False).stderr)
    def test_partial_adjustment_void_and_retry(self):
        body=self.payment(self.assignments[1],1000)
        first=self.call(self.owner,'payment',body,key='partial').stdout
        self.assertEqual(self.call(self.owner,'payment',body,key='partial').stdout,first)
        payment=json.loads(first)['id']
        self.assertEqual(self.detail(self.owner)['totalDueCents'],3500)
        adjustment=dict(cleaningId=self.assignments[1],amountCents=100,reason='Additional agreed task')
        self.call(self.owner,'adjustment',adjustment,key='adjust')
        self.call(self.owner,'adjustment',adjustment,key='adjust')
        self.assertEqual(self.detail(self.owner)['totalDueCents'],3600)
        self.assertEqual(scalar(f"select completed_pay_cents from public.assignments where id='{self.assignments[1]}';"),'4500')
        self.assertIn('NOT_FOUND',self.call(self.other,'void',dict(paymentId=payment,reason='wrong owner'),ok=False).stderr)
        self.call(self.owner,'void',dict(paymentId=payment,reason='Incorrect external record'),key='void')
        self.call(self.owner,'void',dict(paymentId=payment,reason='Incorrect external record'),key='void')
        detail=self.detail(self.owner)
        self.assertEqual(detail['totalDueCents'],4600)
        self.assertEqual(detail['payments'][0]['voidReason'],'Incorrect external record')
        self.assertEqual(self.detail(self.admin,True)['totalDueCents'],7500)
        self.assertEqual(self.detail(self.other)['totalDueCents'],9000)
    def test_concurrent_payments_serialize(self):
        body=self.payment(self.assignments[1],3000)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:self.call(self.owner,'payment',body,ok=False),range(2)))
        self.assertEqual(sum(r.returncode==0 for r in results),1,[r.stderr for r in results])
        self.assertEqual(self.detail(self.owner)['totalDueCents'],1500)
    def test_preferences_and_internal_functions_isolated(self):
        self.call(self.owner,'preference',dict(method='Cash'))
        self.call(self.other,'preference',dict(method='Venmo'))
        self.call(self.admin,'preference',dict(method='Zelle'),admin=True)
        self.assertEqual(self.detail(self.owner)['preferredMethod'],'Cash')
        self.assertEqual(self.detail(self.other)['preferredMethod'],'Venmo')
        self.assertEqual(self.detail(self.admin,True)['preferredMethod'],'Zelle')
        for signature in ['private.payout_detail(uuid,uuid)','private.payout_summary(uuid)','private.payout_action(uuid,uuid,text,jsonb,text)']:
            self.assertEqual(scalar(f"select has_function_privilege('authenticated','{signature}','execute');"),'f')

if __name__=='__main__':unittest.main(verbosity=2)
