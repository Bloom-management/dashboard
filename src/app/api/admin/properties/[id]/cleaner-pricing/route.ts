import { response,mutation,uuid,integer } from '@/server/db/http';
import { userRpc } from '@/server/db/rpc';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,context:Context){return response(async()=>userRpc('bloom_admin_pricing',{p_property:uuid((await context.params).id)}));}
export async function POST(request:Request,context:Context){return response(async()=>{const {body,key}=await mutation(request,['cents']);return userRpc('bloom_admin_set_pricing',{p_id:uuid((await context.params).id),p_cents:integer(body.cents,2,100000000),p_key:key});});}
