import 'server-only';
import { invitedRole } from './invited-role';
import { currentUser as clerkCurrentUser } from '@clerk/nextjs/server';
import { authenticatedDatabase,currentUser } from './session';
import { privilegedDatabase } from '../db/privileged';
import { BackendError,databaseError } from '../db/errors';

/** Accept only server-owned Clerk invitation metadata and its verified primary email.
 * Insert-only provisioning never changes an existing account's role. */
export async function claimInvitation(){
 const {subject}=await authenticatedDatabase();
 const identity=await clerkCurrentUser();
 if(!identity||identity.id!==subject)throw new BackendError('UNAUTHENTICATED');
 const invite=identity.publicMetadata.bloomInvite as Record<string,unknown>|undefined;
 const email=identity.emailAddresses.find(item=>item.id===identity.primaryEmailAddressId);
 const role=invitedRole(invite,email?.emailAddress??'',email?.verification?.status==='verified');
 if(!role)return null;
 const name=(identity.fullName||identity.username||'Account').replace(/[\p{Cc}\p{Cf}]/gu,'').trim().slice(0,100);
 const {error}=await privilegedDatabase().from('users').upsert({clerk_user_id:subject,role,display_name:name},{onConflict:'clerk_user_id',ignoreDuplicates:true});
 if(error)databaseError(error);
 return currentUser();
}
