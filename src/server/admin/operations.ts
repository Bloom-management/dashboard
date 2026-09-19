import 'server-only';
import type { CleanerJob, Role, SessionUser } from '../../contracts';
import type { CityChangeRequest } from '../jobs/operations';
import { userRpc } from '../db/rpc';
export type PropertySetup = { cityId: string; name: string; timezone: string; address: string; isBloomOwned: boolean; soloRateCents: number; ownerIds: string[]; instructions: string; pendingOwnerEmail?: string | null };
export type AdminProperty = { id: string; city_id: string; name: string; timezone: string; address: string; is_bloom_owned: boolean; solo_rate_cents: number; active: boolean };
export const listProperties = (limit = 50, offset = 0) => userRpc<AdminProperty[]>('bloom_admin_properties', { p_limit: limit, p_offset: offset });
export const createProperty = (data: PropertySetup, key: string) => userRpc<AdminProperty>('bloom_admin_property', { p_data: data, p_key: key });
export const grantRole = (userId: string, role: Role, key: string) => userRpc<SessionUser>('bloom_admin_role', { p_user: userId, p_role: role, p_key: key });
export const resolveCity = (id: string, decision: 'approved' | 'rejected', key: string) => userRpc<CityChangeRequest>('bloom_city_resolve', { p_request: id, p_decision: decision, p_key: key });
export const adminJobAction = (jobId: string, action: 'cancel' | 'reassign' | 'keep' | 'reschedule', expectedVersion: number, payload: Record<string, unknown>, key: string) =>
  userRpc<CleanerJob>('bloom_job_action', { p_job: jobId, p_action: action, p_expected_version: expectedVersion, p_payload: payload, p_key: key });
