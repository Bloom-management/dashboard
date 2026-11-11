import {mutation,response,uuid} from '@/server/db/http';
import {BackendError} from '@/server/db/errors';
import {userRpc} from '@/server/db/rpc';
// Empty clears the comment.
const notes=(value:unknown)=>{if(typeof value!=='string'||value.length>500)throw new BackendError('VALIDATION_ERROR');return value;};
/** Comments on room-visit maintenance items flagged "Needs attention". */
export async function GET(_request:Request,context:{params:Promise<{id:string}>}) {
 return response(async()=>userRpc('bloom_visit_item_notes',{p_job:uuid((await context.params).id)}));
}
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
 return response(async()=>{const {body,key}=await mutation(request,['itemId','notes']);return userRpc('bloom_visit_item_notes',{p_job:uuid((await context.params).id),p_item:uuid(body.itemId),p_notes:notes(body.notes),p_key:key});});
}
