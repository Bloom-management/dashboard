import type { CleanerJob } from '../../contracts';

/** Hints only; database time and the mutation response determine eligibility. */
export function mayWithdraw(job: Pick<CleanerJob, 'startAt' | 'withdrawalDeadlineExempt' | 'management'>, now: number) {
  return job.management === 'private' || job.withdrawalDeadlineExempt === true || now <= Date.parse(job.startAt) - 6 * 60 * 60 * 1000;
}
export function mayClaim(job: CleanerJob, now: number) {
  return job.management !== 'private' && job.status === 'open' && !job.reviewRequired && job.activeCleanerCount < 2 && !job.myAssignmentId && now < Date.parse(job.endAt);
}
