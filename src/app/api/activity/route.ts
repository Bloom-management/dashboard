import {response} from '@/server/db/http';
import {userRpc} from '@/server/db/rpc';
import {BackendError} from '@/server/db/errors';
export async function GET(request:Request) {
 return response(async()=>{
  const query=new URL(request.url).searchParams;
  const offset=Number(query.get('offset')??0),job=query.get('job');
  if(!Number.isInteger(offset)||offset<0||offset>100000||(job&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(job)))throw new BackendError('VALIDATION_ERROR');
  return userRpc('bloom_cleaning_activity',{p_offset:offset,p_job:job||null});
 });
}
