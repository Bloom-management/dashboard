import 'server-only';
import { ClerkIntegrationRequired } from './token-configuration';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { currentUser } from './session';
import { BloomAccountRequired } from './account-lookup';
import { BackendError } from '../db/errors';
import { identityConfigured } from '../config';
import type { Role } from '../../contracts';
export async function pageSession(returnTo?:string) {
  if (!identityConfigured()) return null;
  const identity = await auth();
  if (!identity.userId) redirect(returnTo?`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`:'/sign-in');
  try { return await currentUser(); }
  catch (error) {
    if (error instanceof ClerkIntegrationRequired) redirect('/setup/clerk');
    if (error instanceof BloomAccountRequired || (error instanceof BackendError && error.code==='INVALID_STATE')) redirect('/onboarding');
    if (error instanceof BackendError && error.code === 'UNAUTHENTICATED') redirect(returnTo?`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`:'/sign-in');
    // Missing schema/service configuration is an expected setup state, not a render crash.
    if (error instanceof BackendError && error.code === 'CONFIGURATION_ERROR') return null;
    throw error;
  }
}
export async function requirePageRole(role: Role,returnTo?:string) {
  const user = await pageSession(returnTo);
  if (user && user.role !== role && !((role === 'cleaner' || role === 'owner') && user.role === 'admin')) redirect(`/${user.role}`);
  return user;
}
