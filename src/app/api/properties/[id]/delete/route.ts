import { mutation, response, uuid } from '@/server/db/http';
import { userRpc } from '@/server/db/rpc';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
 return response(async()=>{
  const propertyId=uuid((await context.params).id);
  const {key}=await mutation(request,[]);
  return userRpc<{id:string;deleted:true}>('bloom_property_delete',{p_property:propertyId,p_key:key});
 });
}
