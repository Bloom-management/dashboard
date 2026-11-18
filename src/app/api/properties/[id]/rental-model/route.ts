import { choice, mutation, response, uuid } from '@/server/db/http';
import { userRpc } from '@/server/db/rpc';
export const runtime='nodejs';
// Entire unit <-> room model. The database validates every payload field and authorizes the actor.
export async function GET(_request:Request,context:{params:Promise<{id:string}>}) {
 return response(async()=>userRpc('bloom_rental_model',{p_property:uuid((await context.params).id),p_action:'read',p_data:null,p_key:null}));
}
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
 return response(async()=>{
  const propertyId=uuid((await context.params).id);
  const {body,key}=await mutation(request,['action','data']);
  return userRpc('bloom_rental_model',{p_property:propertyId,p_action:choice(body.action,['split','merge','cancel_merge','confirm_channel']),p_data:body.data??{},p_key:key});
 });
}
