import 'server-only';
import { createClerkClient } from '@clerk/nextjs/server';
import { BackendError } from '../db/errors';

/** Call only after requireAdmin. Use the configured Clerk instance for directory and invitations. */
export function adminIdentityClient() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey || secretKey.startsWith('replace_')) throw new BackendError('CONFIGURATION_ERROR');
  return createClerkClient({ secretKey });
}
