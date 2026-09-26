import {userRpc} from '@/server/db/rpc';
import {response,uuid} from '@/server/db/http';
export const runtime='nodejs';
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){return response(async()=>userRpc('bloom_property_team_jobs',{p_property:uuid((await context.params).id)}));}
