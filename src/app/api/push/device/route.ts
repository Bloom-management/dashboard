import { auth } from '@clerk/nextjs/server';
import { response,mutation } from '../../../../server/db/http';
import { deviceId,pushRpc,deviceAction } from '../../../../server/push/runtime';
export async function POST(request:Request){return response(async()=>{
 const {body}=await mutation(request,['disable','unlink','link']);const device=await deviceId();if(!device)return {};
 // Device-wide disable works while signed out; it needs the HttpOnly capability.
 if(body.disable===true)return pushRpc('bloom_push_device',{p_device:device,p_user:null,p_session:null,p_action:'detach'});
 const identity=await auth();if(!identity.userId)return {};
 return deviceAction(body.unlink===true?'unlink':body.link===true?'link':'status');
});}
