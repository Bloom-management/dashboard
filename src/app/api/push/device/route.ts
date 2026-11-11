import { response,mutation } from '../../../../server/db/http';
import { BackendError } from '../../../../server/db/errors';
import { deviceAction } from '../../../../server/push/runtime';
export async function POST(request:Request){return response(async()=>{
 const {body}=await mutation(request,['accountId','unlink','link']);
 if(typeof body.accountId!=='string'||(body.unlink!==true&&body.link!==true))throw new BackendError('VALIDATION_ERROR');
 // A device capability and authenticated account are both required. Never opt out other accounts.
 return deviceAction(body.unlink===true?'unlink':'link',body);
});}
