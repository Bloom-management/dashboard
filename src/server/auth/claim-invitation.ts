import 'server-only';
import { resolveOnboarding } from './onboarding';
import { currentUser } from './session';
/** Compatibility read: role provisioning now happens only at atomic onboarding completion. */
export async function claimInvitation(){const state=await resolveOnboarding();return state.status==='complete'?currentUser():null;}
