import { response,mutation } from '../../../../server/db/http';
import { BackendError } from '../../../../server/db/errors';
import { deviceAction } from '../../../../server/push/runtime';
export const runtime='nodejs';
export async function GET(){return response(()=>deviceAction('status'));}
export async function POST(request:Request){return response(async()=>{
 const {body}=await mutation(request,['accountId','pushEnabled','newJobs','reminders','completions','starts','lowSupplies','maintenance','unclaimed','assignments','teammates','changes','payments','coverage','calendar','requests','payouts','invitations']);
 if(typeof body.accountId!=='string'||Object.entries(body).some(([key,value])=>key!=='accountId'&&typeof value!=='boolean'))throw new BackendError('VALIDATION_ERROR');
 return deviceAction('preferences',body);
});}
