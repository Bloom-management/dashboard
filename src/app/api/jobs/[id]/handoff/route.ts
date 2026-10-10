import {integer,mutation,response,uuid} from '@/server/db/http';
import {BackendError} from '@/server/db/errors';
import {userRpc} from '@/server/db/rpc';
export async function GET(_request:Request,context:{params:Promise<{id:string}>}) {
 return response(async()=>userRpc('bloom_cleaning_handoff',{p_job:uuid((await context.params).id)}));
}
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
 return response(async()=>{const {body,key}=await mutation(request,['draft','revision']);if(!body.draft||typeof body.draft!=='object'||Array.isArray(body.draft))throw new BackendError('VALIDATION_ERROR');return userRpc('bloom_cleaning_handoff',{p_job:uuid((await context.params).id),p_draft:body.draft,p_revision:integer(body.revision,0,2147483647),p_key:key});});
}
