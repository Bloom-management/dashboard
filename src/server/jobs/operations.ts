import 'server-only';
import type { CleanerJob, LocalDate, SessionUser, OwnerCalendarBlock } from '../../contracts';
import { userRpc } from '../db/rpc';
export type CityChangeRequest = {
  id: string; cleaner_id: string; requested_city_id: string;
  status: 'pending' | 'approved' | 'rejected'; resolved_by: string | null; resolved_at: string | null;
};
export const onboardCleaner = (cityId: string, key: string) => userRpc<SessionUser>('bloom_onboard', { p_city: cityId, p_key: key });
export const requestCityChange = (cityId: string, key: string) => userRpc<CityChangeRequest>('bloom_city_request', { p_city: cityId, p_key: key });
export const listJobs = (from: LocalDate, to: LocalDate) => userRpc<CleanerJob[]>('bloom_jobs', { p_from: from, p_to: to });
export const ownerCalendar = (from: LocalDate, to: LocalDate) => userRpc<OwnerCalendarBlock[]>('bloom_owner_calendar', { p_from: from, p_to: to });
export function jobAction(jobId: string, action: 'claim' | 'withdraw' | 'complete', key: string): Promise<CleanerJob> {
  return userRpc('bloom_job_action', { p_job: jobId, p_action: action, p_key: key });
}
