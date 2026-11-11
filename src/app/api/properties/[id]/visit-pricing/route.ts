import {response,mutation,uuid,integer} from '../../../../../server/db/http';
import {userRpc} from '../../../../../server/db/rpc';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,c:Context){return response(async()=>userRpc('bloom_house_pricing',{p_property:uuid((await c.params).id)}));}
export async function POST(request:Request,c:Context){return response(async()=>{const {body,key}=await mutation(request,['rules','revision']);return userRpc('bloom_house_pricing',{p_property:uuid((await c.params).id),p_rules:body.rules,p_revision:integer(body.revision,0,2147483646),p_key:key});});}
