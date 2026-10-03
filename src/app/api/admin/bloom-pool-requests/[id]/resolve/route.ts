import {response,mutation,uuid,choice} from '../../../../../../server/db/http';
import {userRpc} from '../../../../../../server/db/rpc';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
 return response(async()=>{const {body,key}=await mutation(request,['decision']);const {id}=await context.params;return userRpc('bloom_pool_resolve',{p_request:uuid(id),p_decision:choice(body.decision,['approved','rejected']),p_key:key});});
}
