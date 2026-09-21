import { response,mutation,uuid,integer,text } from '@/server/db/http';
import { userRpc } from '@/server/db/rpc';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return response(async()=>{const {body,key}=await mutation(request,['cents','expectedVersion','reason']);return userRpc('bloom_admin_set_pricing',{p_id:uuid((await context.params).id),p_cents:integer(body.cents,2,100000000),p_key:key,p_job:true,p_version:integer(body.expectedVersion,0,2147483647),p_reason:text(body.reason,1000)});});}
