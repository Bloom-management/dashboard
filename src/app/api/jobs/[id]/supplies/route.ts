import { response, uuid } from '@/server/db/http';
import { userRpc } from '@/server/db/rpc';
export const runtime='nodejs';
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){return response(async()=>userRpc('bloom_job_supplies',{p_job:uuid((await context.params).id)}));}
