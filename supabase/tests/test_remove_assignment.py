"""Real disposable PostgreSQL, synthetic JWT claims (not Clerk/browser)."""
import unittest,json,uuid
from test_database import sql,scalar,make_user,make_job,action
class Removal(unittest.TestCase):
 def test_admin_deadline_retry_permissions_and_history(self):
  admin,aid=make_user('admin');cleaner,cid=make_user();owner,oid=make_user('owner')
  job,prop=make_job();self.assertEqual(action(admin,job,'claim').returncode,0)
  sql(f"update public.jobs set checkout_date=current_date-1,start_at=((current_date-1)+time '11:00') at time zone timezone_snapshot,end_at=((current_date-1)+time '15:00') at time zone timezone_snapshot where id='{job}';")
  assignment=scalar(f"select id from public.assignments where job_id='{job}' and ended_at is null;")
  version=scalar(f"select version from public.jobs where id='{job}';")
  self.assertIn('WITHDRAWAL_DEADLINE',action(admin,job,'withdraw').stderr)
  key=str(uuid.uuid4());q=f"select public.bloom_remove_job_assignment('{job}','{assignment}','Coverage changed',{version},'{key}');"
  for subject in [cleaner,owner]:self.assertIn('NOT_FOUND',sql(q,subject,ok=False).stderr)
  self.assertIn('VALIDATION_ERROR',sql(q.replace('Coverage changed',' '),admin,ok=False).stderr)
  self.assertIn('CONFLICT',sql(q.replace(f',{version},',',999999,'),admin,ok=False).stderr)
  first=scalar(q,admin);self.assertEqual(first,scalar(q,admin));self.assertEqual(scalar(f"select count(*) from public.assignments where job_id='{job}' and ended_at is null;"),'0')
  self.assertEqual(scalar(f"select withdrawal_comment from public.assignments where id='{assignment}';"),'Coverage changed')
  sql(f"update public.jobs set status='completed',completed_at=now(),completed_by='{aid}' where id='{job}';")
  self.assertIn('INVALID_STATE',sql(q.replace(key,str(uuid.uuid4())),admin,ok=False).stderr)
 def test_private_owner_and_cross_owner(self):
  owner,oid=make_user('owner');other,_=make_user('owner');cleaner,cid=make_user();job,prop=make_job()
  sql(f"insert into public.property_owners values('{prop}','{oid}');update public.jobs set cleaning_management='private',payer_owner_id='{oid}' where id='{job}';insert into private.property_cleaner_members(property_id,cleaner_id) values('{prop}','{cid}');insert into public.assignments(job_id,cleaner_id,slot) values('{job}','{cid}',1);")
  assignment=scalar(f"select id from public.assignments where job_id='{job}';");version=scalar(f"select version from public.jobs where id='{job}';")
  q=f"select public.bloom_remove_job_assignment('{job}','{assignment}','Owner requested',{version},'{uuid.uuid4()}');"
  self.assertIn('NOT_FOUND',sql(q,other,ok=False).stderr);self.assertEqual(sql(q,owner).returncode,0)
if __name__=='__main__':unittest.main(verbosity=2)
