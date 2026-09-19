import 'server-only';
import { currentUser as clerkCurrentUser } from '@clerk/nextjs/server';
import { authenticatedDatabase } from './session';
import { isSessionUser } from './account-diagnostics';
import { BackendError } from '../db/errors';

type ReadEvidence = { status: number; databaseCode: string | null; accepted: boolean; rows: number | null };
function evidence(result: { status: number; error: { code?: string } | null; data: unknown }): ReadEvidence {
  return {
    status: result.status,
    databaseCode: result.error?.code && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(result.error.code) ? result.error.code : null,
    accepted: !result.error && result.status >= 200 && result.status < 300,
    rows: Array.isArray(result.data) ? result.data.length : null,
  };
}
/** Temporary server-side call site only, after #1 confirms connectivity.
 * No endpoint, writes, privileged database client, token minting, or returned identity data.
 * expectedVerifiedEmail comes from #1 privately and is never logged or returned.
 */
export async function probeCurrentAccountAccess(expectedVerifiedEmail: string, expectedLocalPort: number) {
  let target: URL;
  try { target = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''); }
  catch { throw new BackendError('CONFIGURATION_ERROR'); }
  if (!['127.0.0.1', '[::1]', 'localhost'].includes(target.hostname) || Number(target.port) !== expectedLocalPort ||
    !['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash ||
    !Number.isInteger(expectedLocalPort) || expectedLocalPort < 1 || expectedLocalPort > 65535 || !expectedVerifiedEmail.trim()) {
    throw new BackendError('CONFIGURATION_ERROR');
  }
  const { db, subject, diagnostics } = await authenticatedDatabase();
  const clerkUser = await clerkCurrentUser();
  const verifiedIdentityMatched = !!clerkUser && clerkUser.id === subject && clerkUser.emailAddresses.some(
    email => email.verification?.status === 'verified' && email.emailAddress.toLowerCase() === expectedVerifiedEmail.trim().toLowerCase(),
  );
  if (!verifiedIdentityMatched) throw new BackendError('FORBIDDEN');
  const me = await db.rpc('bloom_me');
  const account = diagnostics.lookup(me);
  if (me.error || !isSessionUser(me.data) || me.data.role !== 'admin') {
    return { verifiedIdentityMatched, intendedAdminRetained: false, account };
  }
  const mapping = await db.from('users').select('id,role').eq('clerk_user_id', subject).limit(2);
  const uniqueMappingMatched = !mapping.error && mapping.data?.length === 1 && mapping.data[0].id === me.data.id && mapping.data[0].role === 'admin';
  const today = new Date(); const end = new Date(today.getTime() + 31 * 86_400_000);
  const jobs = await db.rpc('bloom_jobs', { p_from: today.toISOString().slice(0, 10), p_to: end.toISOString().slice(0, 10) });
  const jobTokenForwarded = diagnostics.snapshot().originalTokenForwarded;
  const properties = await db.from('properties').select('id').limit(1);
  const propertyTokenForwarded = diagnostics.snapshot().originalTokenForwarded;
  const propertyOptions = await db.rpc('bloom_admin_property_options', { p_id: null, p_cursor: null });
  const propertyOptionsTokenForwarded = diagnostics.snapshot().originalTokenForwarded;
  const ownership = await db.from('property_owners').select('property_id,properties!inner(id)').limit(1);
  const ownershipTokenForwarded = diagnostics.snapshot().originalTokenForwarded;
  return {
    verifiedIdentityMatched, intendedAdminRetained: uniqueMappingMatched, account,
    mapping: evidence(mapping), adminCleanerView: { ...evidence(jobs), originalTokenForwarded: jobTokenForwarded },
    adminProperties: { ...evidence(properties), originalTokenForwarded: propertyTokenForwarded },
    adminPropertyOptions: { ...evidence({ ...propertyOptions, data: propertyOptions.data?.items }), originalTokenForwarded: propertyOptionsTokenForwarded },
    adminOwnershipJoin: { ...evidence(ownership), originalTokenForwarded: ownershipTokenForwarded },
    // This admin request cannot establish another owner's isolation or grant/mutation behavior.
    crossOwnerIsolationVerified: false,
  };
}
