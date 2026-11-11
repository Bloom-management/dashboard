import {response,uuid} from '../../../../../server/db/http';
import {userRpc} from '../../../../../server/db/rpc';
export async function GET(_request:Request,c:{params:Promise<{id:string}>}){return response(async()=>userRpc('bloom_property_room_visits',{p_property:uuid((await c.params).id)}));}
