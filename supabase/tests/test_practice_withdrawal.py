"""Explicit local practice exceptions must not relax other jobs/users."""
import unittest,json
from test_database import sql,scalar,make_user,make_job,action
class PracticeWithdrawal(unittest.TestCase):
 def test_exception_is_scoped_and_not_self_grantable(self):
  actor,uid=make_user();other,_=make_user();job,_=make_job();normal,_=make_job()
  zone=scalar("select name from pg_timezone_names where name like 'Etc/%' and extract(hour from clock_timestamp() at time zone name)=12 limit 1;")
  for j in [job,normal]:sql(f"update jobs set timezone_snapshot='{zone}',checkout_date=(clock_timestamp() at time zone '{zone}')::date,start_at=(((clock_timestamp() at time zone '{zone}')::date)+time '11:00') at time zone '{zone}',end_at=(((clock_timestamp() at time zone '{zone}')::date)+time '15:00') at time zone '{zone}' where id='{j}';")
  self.assertNotEqual(sql(f"insert into private.practice_withdrawal_exceptions values('{uid}','{job}');",actor,ok=False).returncode,0)
  sql(f"insert into private.practice_withdrawal_exceptions values('{uid}','{job}');")
  for who,j in [(actor,job),(other,job),(actor,normal)]:self.assertEqual(action(who,j,'claim').returncode,0)
  self.assertEqual(action(actor,job,'withdraw').returncode,0)
  self.assertIn('WITHDRAWAL_DEADLINE',action(other,job,'withdraw').stderr)
  self.assertIn('WITHDRAWAL_DEADLINE',action(actor,normal,'withdraw').stderr)
  self.assertTrue(json.loads(scalar(f"select private.job_dto('{job}');"))['withdrawalDeadlineExempt']==False)
  # Public actor-authorized read exposes the hint only to the matching user.
  date=scalar(f"select checkout_date from jobs where id='{job}';")
  rows=json.loads(scalar(f"select bloom_jobs('{date}','{date}');",actor));self.assertTrue(next(x for x in rows if x['id']==job)['withdrawalDeadlineExempt'])
  rows=json.loads(scalar(f"select bloom_jobs('{date}','{date}');",other));self.assertFalse(next(x for x in rows if x['id']==job)['withdrawalDeadlineExempt'])
if __name__=='__main__':unittest.main(verbosity=2)
