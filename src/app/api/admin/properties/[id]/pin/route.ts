import {response,mutation,uuid} from '../../../../../../server/db/http';
import {userRpc} from '../../../../../../server/db/rpc';
import {BackendError} from '../../../../../../server/db/errors';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,c:Context){return response(async()=>userRpc('bloom_property_pin',{p_property:uuid((await c.params).id)}));}
export async function POST(request:Request,c:Context){return response(async()=>{const {body}=await mutation(request,['latitude','longitude','confirmed']);if(typeof body.latitude!=='number'||typeof body.longitude!=='number'||!Number.isFinite(body.latitude)||!Number.isFinite(body.longitude)||body.confirmed!==true)throw new BackendError('VALIDATION_ERROR');return userRpc('bloom_property_pin',{p_property:uuid((await c.params).id),p_pin:body});});}
