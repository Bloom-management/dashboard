import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { resolveOnboarding } from '../../server/auth/onboarding';
import { ClerkIntegrationRequired } from '../../server/auth/token-configuration';
import { BackendError } from '../../server/db/errors';
import { identityConfigured } from '../../server/config';
import { SetupUnavailable } from '../../components/setup-unavailable';
import { Onboarding } from '../../components/bloom/onboarding';
import '../../styles/bloom-cleaner.css';
import '../../styles/bloom-owner.css';
import '../../styles/bloom-onboarding.css';
export const dynamic = 'force-dynamic';
export default async function Page() {
  if (!identityConfigured()) return <SetupUnavailable />;
  if (!(await auth()).userId) redirect('/sign-in');
  let state;
  try {
    state = await resolveOnboarding();
  } catch (error) {
    if (error instanceof ClerkIntegrationRequired) redirect('/setup/clerk');
    if (error instanceof BackendError) {
      if (error.code === 'UNAUTHENTICATED') redirect('/sign-in');
      if (error.code === 'CONFIGURATION_ERROR' || error.code === 'SOURCE_UNAVAILABLE') return <SetupUnavailable code={error.code} />;
    }
    throw error;
  }
  if (state.status === 'complete') redirect(state.destination);
  return <Onboarding initialState={state} />;
}
