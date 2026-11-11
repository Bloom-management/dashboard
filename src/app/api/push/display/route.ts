import { response,mutation,uuid } from '../../../../server/db/http';
import { BackendError } from '../../../../server/db/errors';
import { deviceId,pushRpc,hash,permittedDevice,type Delivery } from '../../../../server/push/runtime';
export async function POST(request:Request){return response(async()=>{
 const {body}=await mutation(request,['delivery','token']);const device=await deviceId();if(!device)throw new BackendError('FORBIDDEN');
 if(body.token!==undefined&&(typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token)))throw new BackendError('FORBIDDEN');
 const d=await pushRpc<Delivery|null>('bloom_push_display',{p_id:uuid(body.delivery),p_device:device,p_token_hash:typeof body.token==='string'?hash(body.token):null});
 if(!d||!permittedDevice(d.subject,device))throw new BackendError('FORBIDDEN');
 // Verified device capability and an enabled account link authorize display even
 // after logout. Database content checks still enforce current job/property access.
 return {...d.content,url:`/notifications/open?delivery=${uuid(body.delivery)}`};
});}
