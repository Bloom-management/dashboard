import { completeOnboarding, resolveOnboarding } from '../../../server/auth/onboarding';
import { response } from '../../../server/db/http';
export const runtime='nodejs';
export async function GET(){return response(resolveOnboarding);}
export async function POST(request:Request){return response(()=>completeOnboarding(request));}
