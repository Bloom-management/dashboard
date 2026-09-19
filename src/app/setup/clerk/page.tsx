import { UserButton } from '@clerk/nextjs';
import { identityConfigured } from '../../../server/config';
export const dynamic='force-dynamic';
export default function ClerkSetup() {
 return <main style={{maxWidth:680,margin:'60px auto',padding:24,fontFamily:'system-ui,sans-serif'}}>
  {identityConfigured() && <UserButton/>}
  <h1>Connect Clerk to Supabase</h1>
  <p>Your session token is missing the database access claim Bloom needs.</p>
  <ol><li>Open your Bloom development application in the Clerk dashboard and enable its Supabase integration.</li>
  <li>If configuring session claims manually, include <code>{'{"role":"authenticated"}'}</code> in the session token customization.</li>
  <li>Sign out using the account button above, then sign in again to get a fresh token.</li></ol>
  <p>This permits signed-in database access. Bloom admin, owner and cleaner permissions remain protected separately.</p>
  <p><a href="https://supabase.com/docs/guides/auth/third-party/clerk" target="_blank" rel="noreferrer">Clerk–Supabase setup instructions</a></p>
  <a href="/">Return to Bloom</a>
 </main>;
}
