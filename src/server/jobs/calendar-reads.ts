import 'server-only';
import {currentUser} from '../auth/session';
import {adminOwnerFreshness} from '../owner/admin-view';
import { userRpc } from '../db/rpc';
export type OwnerSourceFreshness = { propertyId: string; lastSuccessAt: string | null; message: string };
/** Keyset page of at most 100 owned properties. The next cursor is the last propertyId. */
export const ownerSourceFreshness = async (cursor: string | null = null) =>
  (await currentUser()).role==='admin'?adminOwnerFreshness(cursor):userRpc<OwnerSourceFreshness[]>('bloom_owner_source_freshness', { p_cursor: cursor });
export const assignedJobDetail = (jobId: string) =>
  userRpc<{ address: string; instructions: string }>('bloom_assigned_job_detail', { p_job: jobId });
