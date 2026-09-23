import { auth } from '@clerk/nextjs/server';
import { response,mutation } from '../../../../server/db/http';
import { currentUser } from '../../../../server/auth/session';
import { deviceId,deviceAction,pushRpc } from '../../../../server/push/runtime';
export async function POST(request:Request){return response(async()=>{
 const {body}=await mutation(request,['disable']);const device=await deviceId();if(!device)return {};
 const identity=await auth();
 if(!identity.userId||body.disable===true)return pushRpc('bloom_push_device',{p_device:device,p_user:null,p_session:null,p_action:'detach'});
 const user=await currentUser();if(user.role!=='cleaner')return pushRpc('bloom_push_device',{p_device:device,p_user:null,p_session:null,p_action:'detach'});
 return deviceAction('status');
});}
