import {response,mutation} from '../../../server/db/http';
import {userRpc} from '../../../server/db/rpc';
import {BackendError} from '../../../server/db/errors';
export async function GET(request:Request){return response(()=>{const offset=Number(new URL(request.url).searchParams.get('offset')??0);if(!Number.isInteger(offset)||offset<0||offset>100000)throw new BackendError('VALIDATION_ERROR');return userRpc('bloom_notification_inbox',{p_offset:offset});});}
export async function POST(request:Request){return response(async()=>{const {body}=await mutation(request,['id']);if(typeof body.id!=='string'||body.id.length>100)throw new BackendError('VALIDATION_ERROR');return userRpc('bloom_notification_dismiss',{p_id:body.id});});}
