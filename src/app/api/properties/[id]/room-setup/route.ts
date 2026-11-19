import { choice, mutation, response, uuid } from '@/server/db/http';
import { userRpc } from '@/server/db/rpc';
export const runtime='nodejs';
// Room draft setup: house shared spaces and cleaning prices. The database validates and authorizes.
export async function GET(_request:Request,context:{params:Promise<{id:string}>}) {
 return response(async()=>userRpc('bloom_room_setup',{p_property:uuid((await context.params).id),p_action:'read',p_data:null,p_key:null}));
}
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
 return response(async()=>{
  const propertyId=uuid((await context.params).id);
  const {body,key}=await mutation(request,['action','data']);
  return userRpc('bloom_room_setup',{p_property:propertyId,p_action:choice(body.action,['shared','pricing']),p_data:body.data??{},p_key:key});
 });
}
