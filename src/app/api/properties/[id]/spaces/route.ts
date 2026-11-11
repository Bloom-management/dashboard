import {response,mutation,uuid} from '../../../../../server/db/http';
import {userRpc} from '../../../../../server/db/rpc';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,c:Context){return response(async()=>userRpc('bloom_room_spaces',{p_property:uuid((await c.params).id)}));}
export async function POST(request:Request,c:Context){return response(async()=>{const {body,key}=await mutation(request,['spaces']);return userRpc('bloom_room_spaces',{p_property:uuid((await c.params).id),p_spaces:body.spaces,p_key:key});});}
