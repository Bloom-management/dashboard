import { BackendError } from '../db/errors';
export class ClerkIntegrationRequired extends BackendError {
  constructor() { super('CONFIGURATION_ERROR'); }
}
/** Configuration check only. Supabase still verifies the original signed token.
 * Never mint/modify a token or derive a Bloom business role from these claims.
 */
export function assertSupabaseTokenConfiguration(token: string) {
  let role: unknown;
  try { role = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).role; }
  catch { throw new ClerkIntegrationRequired(); }
  if (role !== 'authenticated') {
    if (process.env.NODE_ENV === 'development') console.info('[Bloom account token]', JSON.stringify({
      authenticatedRoleClaim: false, roleClaimPresent: role !== undefined,
    }));
    throw new ClerkIntegrationRequired();
  }
}
