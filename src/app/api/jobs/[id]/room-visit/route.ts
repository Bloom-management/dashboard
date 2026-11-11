import {response,mutation,uuid,integer,choice} from '../../../../../server/db/http';
import {userRpc} from '../../../../../server/db/rpc';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,c:Context){return response(async()=>userRpc('bloom_room_visit',{p_job:uuid((await c.params).id)}));}
export async function POST(request:Request,c:Context){return response(async()=>{const {body,key}=await mutation(request,['action','data','version']);return userRpc('bloom_room_visit_action',{p_job:uuid((await c.params).id),p_action:choice(body.action,['space','accept','decline','coordinate','cancel_visit']),p_data:body.data??{},p_version:integer(body.version,1,2147483646),p_key:key});});}
