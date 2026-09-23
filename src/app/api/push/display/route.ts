import { auth } from '@clerk/nextjs/server';
import { response,mutation,uuid } from '../../../../server/db/http';
import { BackendError } from '../../../../server/db/errors';
import { deviceId,pushRpc,sessionActive,permitted,type Delivery } from '../../../../server/push/runtime';
export async function POST(request:Request){return response(async()=>{
 const {body}=await mutation(request,['delivery']);const device=await deviceId();if(!device)throw new BackendError('FORBIDDEN');
 const d=await pushRpc<Delivery|null>('bloom_push_delivery',{p_id:uuid(body.delivery),p_device:device});
 if(!d||!permitted(d.subject)||!await sessionActive(d.session,d.subject))throw new BackendError('FORBIDDEN');
 // A closed PWA cannot refresh Clerk's short-lived cookie. The HttpOnly device capability,
 // proof of receipt, DB binding, and live server-side Clerk session check authorize this read.
 const current=await auth();if(current.userId&&(current.userId!==d.subject||current.sessionId!==d.session))throw new BackendError('FORBIDDEN');
 return d.content;
});}
