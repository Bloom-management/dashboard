import { response,mutation } from '../../../../server/db/http';
import { BackendError } from '../../../../server/db/errors';
import { deviceAction,hash } from '../../../../server/push/runtime';
export async function POST(request:Request){return response(async()=>{const {body}=await mutation(request,['proof']);if(typeof body.proof!=='string'||! /^[a-f\d]{64}$/.test(body.proof))throw new BackendError('VALIDATION_ERROR');return deviceAction('verify',{hash:hash(body.proof)});});}
