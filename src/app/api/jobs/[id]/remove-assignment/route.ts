import {response,mutation,uuid,text,integer} from '@/server/db/http';
import {userRpc} from '@/server/db/rpc';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 return response(async()=>{
  const {body,key}=await mutation(request,['assignmentId','reason','expectedVersion']);
  return userRpc('bloom_remove_job_assignment',{p_job:uuid((await context.params).id),p_assignment:uuid(body.assignmentId),p_reason:text(body.reason,1000),p_version:integer(body.expectedVersion,0,2147483647),p_key:key});
 });
}
