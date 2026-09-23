import { randomBytes,randomUUID } from 'node:crypto';
import { response,mutation,uuid } from '../../../../server/db/http';
import { BackendError } from '../../../../server/db/errors';
import { cleaner,deviceAction,permitted,hash,appUrl } from '../../../../server/push/runtime';
import { sendPush } from '../../../../server/push/provider';
export async function POST(request:Request){return response(async()=>{
 const {body}=await mutation(request,['subscription']);const actor=await cleaner();if(!permitted(actor.subject))throw new BackendError('FORBIDDEN');
 const subscription=uuid(body.subscription),secret=randomBytes(32).toString('hex');
 await deviceAction('challenge',{subscription,hash:hash(secret)});
 const sent=await sendPush({subscription,key:randomUUID(),url:appUrl(`/notifications/verify#${secret}`),ttl:60,verification:true});
 // The proof is deliberately NOT returned to the requesting page. It must arrive on the target device.
 if(sent.state!=='accepted')throw new BackendError('SOURCE_UNAVAILABLE');
 return {pending:true,message:'Tap the Bloom verification notification on this device to finish.'};
});}
