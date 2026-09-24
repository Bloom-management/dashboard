import {response,mutation,uuid} from '@/server/db/http';
import {userRpc} from '@/server/db/rpc';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,c:Context){return response(async()=>userRpc('bloom_property_pin_suggestion',{p_property:uuid((await c.params).id)}));}
export async function POST(request:Request,c:Context){return response(async()=>{const {body}=await mutation(request,['latitude','longitude','address','confirmed']);return userRpc('bloom_property_pin_suggestion',{p_property:uuid((await c.params).id),p_pin:body});});}
