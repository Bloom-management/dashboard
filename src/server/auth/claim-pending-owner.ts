import 'server-only';
import { currentUser as clerkCurrentUser } from '@clerk/nextjs/server';
import type { SessionUser } from '../../contracts';
import { authenticatedDatabase, currentUser } from './session';
import { privilegedDatabase } from '../db/privileged';
import { BackendError, databaseError } from '../db/errors';
import { isSessionUser } from './account-diagnostics';

/** The admin preauthorizes ownership; neither HTTP input nor user metadata supplies identity. */
export async function claimPendingOwner(): Promise<SessionUser | null> {
  const { subject } = await authenticatedDatabase();
  const identity = await clerkCurrentUser();
  if (!identity || identity.id !== subject) throw new BackendError('UNAUTHENTICATED');
  const email = identity.emailAddresses.find(value => value.id === identity.primaryEmailAddressId);
  if (!email || email.verification?.status !== 'verified') return null;
  const name = (identity.fullName || identity.username || 'Owner').replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 100) || 'Owner';
  const { data, error } = await privilegedDatabase().rpc('bloom_claim_pending_owner', {
    p_subject: subject, p_email: email.emailAddress, p_display_name: name,
  });
  if (error) databaseError(error);
  if (data === null) return null;
  if (!isSessionUser(data) || data.role !== 'owner') throw new BackendError('CONFIGURATION_ERROR');
  const user = await currentUser();
  if (user.id !== data.id || user.role !== 'owner') throw new BackendError('CONFIGURATION_ERROR');
  return user;
}
