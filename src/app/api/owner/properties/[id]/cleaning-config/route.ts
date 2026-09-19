import { response, mutation, uuid } from '@/server/db/http';
import { userRpc } from '@/server/db/rpc';
export const runtime = 'nodejs';
type Context = {params: Promise<{id: string}>};
export async function GET(_request: Request, context: Context) {
  return response(async () => {return userRpc('bloom_cleaning_config', {p_property:uuid((await context.params).id)});});
}
export async function POST(request: Request, context: Context) {
  return response(async () => {const {body,key}=await mutation(request,['version','rooms','supplies']);return userRpc('bloom_cleaning_config',{p_property:uuid((await context.params).id),p_config:body,p_key:key});});
}
