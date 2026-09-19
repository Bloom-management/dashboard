import 'server-only';
import { assertSupabaseTokenConfiguration } from './token-configuration';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { BackendError } from '../db/errors';
import { accountLookupError } from './account-lookup';
import { accountDiagnostics, isSessionUser } from './account-diagnostics';
import type { SessionUser } from '../../contracts';

/** Verified Clerk session token, never a legacy Supabase JWT template. */
export async function authenticatedDatabase() {
  const diagnostics = accountDiagnostics();
  const configured = (name: string, field: 'clerk_secret' | 'supabase_url' | 'publishable_key') => {
    const value = process.env[name];
    if (!value || value.startsWith('replace_')) {
      diagnostics.configurationFailure(field);
      throw new BackendError('CONFIGURATION_ERROR');
    }
    return value;
  };
  configured('CLERK_SECRET_KEY', 'clerk_secret');
  const session = await auth();
  if (!session.userId) throw new BackendError('UNAUTHENTICATED');
  const token = await session.getToken();
  if (!token) throw new BackendError('UNAUTHENTICATED');
  diagnostics.verifiedSession();
  const target = configured('NEXT_PUBLIC_SUPABASE_URL', 'supabase_url');
  const key = configured('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable_key');
  try { assertSupabaseTokenConfiguration(token); diagnostics.tokenConfigurationAccepted(); }
  catch (error) { diagnostics.configurationFailure('clerk_integration_claim', error); throw error; }
  const observedFetch = diagnostics.observeFetch(target, token);
  try {
    const db = createClient(target, key, {
      accessToken: async () => token,
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: observedFetch },
    });
    return { db, subject: session.userId, diagnostics };
  } catch (error) {
    diagnostics.configurationFailure('client_initialization', error);
    throw new BackendError('CONFIGURATION_ERROR');
  }
}
export async function currentUser(): Promise<SessionUser> {
  const { db, diagnostics } = await authenticatedDatabase();
  const result = await db.rpc('bloom_me');
  diagnostics.lookup(result);
  if (result.error) accountLookupError(result.error, result.status);
  if (result.status < 200 || result.status >= 300 || !isSessionUser(result.data)) throw new BackendError('CONFIGURATION_ERROR');
  const user = result.data;
  return { id: user.id, role: user.role, displayName: user.displayName, approvedCityId: user.approvedCityId };
}
export async function requireAdmin(): Promise<SessionUser> {
  const user = await currentUser();
  if (user.role !== 'admin') throw new BackendError('FORBIDDEN');
  return user;
}
