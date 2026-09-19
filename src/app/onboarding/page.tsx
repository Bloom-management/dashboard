import { incomingPropertyInvitations } from '../../server/owner/people';
import { claimInvitation } from '../../server/auth/claim-invitation';
import { claimPendingOwner } from '../../server/auth/claim-pending-owner';
import { ClerkIntegrationRequired } from '../../server/auth/token-configuration';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { currentUser } from '../../server/auth/session';
import { BloomAccountRequired } from '../../server/auth/account-lookup';
import { BackendError } from '../../server/db/errors';
import { identityConfigured } from '../../server/config';
import { SetupUnavailable } from '../../components/setup-unavailable';
import { Onboarding } from '../../components/bloom/onboarding';
import '../../styles/bloom-cleaner.css';
export const dynamic='force-dynamic';
export default async function Page(){
 if(!identityConfigured())return <SetupUnavailable/>;
 if(!(await auth()).userId)redirect('/sign-in');
 let role: string|null=null;
 try { role=(await currentUser()).role; } catch(error) {
  if(error instanceof ClerkIntegrationRequired)redirect('/setup/clerk');
  if(error instanceof BackendError && error.code==='CONFIGURATION_ERROR')return <SetupUnavailable/>;
  if (!(error instanceof BloomAccountRequired)) {
   if (error instanceof BackendError && error.code === 'UNAUTHENTICATED') redirect('/sign-in');
   throw error;
  }
 }
 if(!role&&(await incomingPropertyInvitations()).length)redirect('/invitations');
 if(!role)role=(await claimInvitation())?.role??null;
 if(!role || role==='owner') {
  try { role=(await claimPendingOwner())?.role ?? role; } catch(error) {
   if(error instanceof BackendError && error.code==='CONFIGURATION_ERROR')return <SetupUnavailable/>;
   throw error;
  }
 }
 if(role)redirect(`/${role}`);
 return <Onboarding/>;
}
