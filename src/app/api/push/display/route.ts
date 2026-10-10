import { response,mutation,uuid } from '../../../../server/db/http';
import { BackendError } from '../../../../server/db/errors';
import { deviceId,pushRpc,permitted,type Delivery } from '../../../../server/push/runtime';
export async function POST(request:Request){return response(async()=>{
 const {body}=await mutation(request,['delivery']);const device=await deviceId();if(!device)throw new BackendError('FORBIDDEN');
 const d=await pushRpc<Delivery|null>('bloom_push_delivery',{p_id:uuid(body.delivery),p_device:device});
 if(!d||!permitted(d.subject))throw new BackendError('FORBIDDEN');
 // Verified device capability and an enabled account link authorize display even
 // after logout. Database content checks still enforce current job/property access.
 return {...d.content,url:`/notifications/open?delivery=${uuid(body.delivery)}`};
});}
