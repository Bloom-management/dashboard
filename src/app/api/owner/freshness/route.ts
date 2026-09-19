import { response } from '@/server/db/http';
import { integrationRead } from '@/server/integration/reads';
export const runtime='nodejs';
export async function GET(request:Request){return response(async()=>integrationRead('ownerFreshness',request));}
