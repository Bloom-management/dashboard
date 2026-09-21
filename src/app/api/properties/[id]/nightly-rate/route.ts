import { response, mutation, uuid, integer } from '../../../../../server/db/http';
import { userRpc } from '../../../../../server/db/rpc';
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
 return response(async()=>{
  const {body,key}=await mutation(request,['cents']);
  return userRpc('bloom_property_nightly_rate',{p_property:uuid((await context.params).id),p_cents:integer(body.cents,0,100000000),p_key:key});
 });
}
