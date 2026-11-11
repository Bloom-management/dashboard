import {response,mutation,uuid,choice} from '../../../../../server/db/http';
import {userRpc} from '../../../../../server/db/rpc';
import {BackendError} from '../../../../../server/db/errors';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
 return response(async()=>userRpc('bloom_job_notes',{p_job:uuid((await context.params).id),p_section:choice(new URL(request.url).searchParams.get('section'),['supplies','maintenance'])}));
}
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 return response(async()=>{const {body,key}=await mutation(request,['section','body']);if(typeof body.body!=='string'||body.body.length>1500)throw new BackendError('VALIDATION_ERROR');
 return userRpc('bloom_job_notes',{p_job:uuid((await context.params).id),p_section:choice(body.section,['supplies','maintenance']),p_body:body.body,p_key:key});});
}
