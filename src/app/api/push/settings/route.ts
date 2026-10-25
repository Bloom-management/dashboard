import { response,mutation } from '../../../../server/db/http';
import { BackendError } from '../../../../server/db/errors';
import { deviceAction } from '../../../../server/push/runtime';
export const runtime='nodejs';
export async function GET(){return response(()=>deviceAction('status'));}
export async function POST(request:Request){return response(async()=>{const {body}=await mutation(request,['newJobs','reminders','completions','starts','lowSupplies','maintenance']);if((body.lowSupplies!==undefined&&typeof body.lowSupplies!=='boolean')||(body.maintenance!==undefined&&typeof body.maintenance!=='boolean')||(body.starts!==undefined&&typeof body.starts!=='boolean')||typeof body.newJobs!=='boolean'||typeof body.reminders!=='boolean'||(body.completions!==undefined&&typeof body.completions!=='boolean'))throw new BackendError('VALIDATION_ERROR');return deviceAction('preferences',body);});}
