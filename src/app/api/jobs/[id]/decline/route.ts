import {response,mutation,text,uuid} from '../../../../../server/db/http';
import {userRpc} from '../../../../../server/db/rpc';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 return response(async()=>{const {body,key}=await mutation(request,['comment']);return userRpc('bloom_decline_job',{p_job:uuid((await params).id),p_comment:text(body.comment,1000),p_key:key});});
}
