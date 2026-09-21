import { resolveOnboarding } from '../../../../server/auth/onboarding';
import { BackendError } from '../../../../server/db/errors';
import { response } from '../../../../server/db/http';
export const runtime='nodejs';
/** Legacy mutation must not bypass verified role resolution or atomic completion. */
export async function POST(){return response(async()=>{await resolveOnboarding();throw new BackendError('INVALID_STATE');});}
