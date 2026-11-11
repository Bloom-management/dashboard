import {mutation,response,uuid} from '@/server/db/http';
import {userRpc} from '@/server/db/rpc';
/** Room-visit maintenance issues: list with comments, or resolve one (owners/admins). */
export async function GET(_request:Request,context:{params:Promise<{id:string}>}) {
 return response(async()=>userRpc('bloom_visit_issues',{p_job:uuid((await context.params).id)}));
}
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
 return response(async()=>{const {body,key}=await mutation(request,['itemId']);return userRpc('bloom_visit_issues',{p_job:uuid((await context.params).id),p_item:uuid(body.itemId),p_key:key});});
}
