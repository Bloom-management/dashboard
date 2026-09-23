import { response,mutation,uuid } from '../../../../server/db/http';
import { BackendError } from '../../../../server/db/errors';
import { cleaner,deviceAction,permitted,dispatch } from '../../../../server/push/runtime';
export async function POST(request:Request){return response(async()=>{const {key}=await mutation(request,[]);if(!permitted((await cleaner()).subject))throw new BackendError('FORBIDDEN');const result=await deviceAction('test',{key});await dispatch(uuid(result.testDeliveryId));return {message:'Test queued for this device. Provider acceptance does not confirm delivery.'};});}
