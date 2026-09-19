import 'server-only';
import { currentUser as clerkCurrentUser } from '@clerk/nextjs/server';
import type { SessionUser } from '../../contracts';
import { authenticatedDatabase } from './session';
import { privilegedDatabase } from '../db/privileged';
import { BackendError, databaseError } from '../db/errors';

/** Call after successful onboarding or during an explicit mapped-profile refresh.
 * Takes no client-supplied identity, role, city, name or user metadata.
 */
export async function provisionVerifiedDisplayName(): Promise<SessionUser> {
  const { subject } = await authenticatedDatabase();
  const clerkUser = await clerkCurrentUser();
  if (!clerkUser || clerkUser.id !== subject) throw new BackendError('UNAUTHENTICATED');
  const name = (clerkUser.fullName || clerkUser.username || 'Account')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim().slice(0, 100) || 'Account';
  const { data, error } = await privilegedDatabase().rpc('bloom_provision_display_name', {
    p_subject: subject, p_display_name: name,
  });
  if (error) databaseError(error);
  return data as SessionUser;
}
