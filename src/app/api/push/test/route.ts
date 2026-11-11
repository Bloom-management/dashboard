import { response,mutation,uuid } from '../../../../server/db/http';
import { BackendError } from '../../../../server/db/errors';
import { pushActor,deviceAction,permitted,dispatch } from '../../../../server/push/runtime';
export async function POST(request:Request){return response(async()=>{const {key,body}=await mutation(request,['accountId']);if(!permitted((await pushActor()).subject))throw new BackendError('FORBIDDEN');const result=await deviceAction('test',{key,accountId:typeof body.accountId==='string'?body.accountId:''});const sent=await dispatch(uuid(result.testDeliveryId));if(!sent.outcomes?.includes('accepted'))throw new BackendError('SOURCE_UNAVAILABLE');return {message:'Test requested.',deliveryId:result.testDeliveryId,providerAccepted:true};});}
