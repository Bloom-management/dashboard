import { auth } from '@clerk/nextjs/server';
import { response,mutation } from '../../../../server/db/http';
import { deviceId,pushRpc } from '../../../../server/push/runtime';
export async function POST(request:Request){return response(async()=>{
 const {body}=await mutation(request,['disable']);const device=await deviceId();if(!device)return {};
 const identity=await auth();
 // Clear an old binding even when the new identity has no Bloom account yet.
 // Never leave the previous cleaner attached because onboarding/account lookup failed.
 return pushRpc('bloom_push_device',{p_device:device,p_user:null,p_session:identity.sessionId??null,p_action:body.disable===true?'detach':'reconcile'});
});}
