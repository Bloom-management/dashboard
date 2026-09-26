import { response } from '@/server/db/http';
import { ownerPayoutMutation } from '@/server/payouts/operations';
export async function POST(request:Request, context:{params:Promise<{cleanerId:string;paymentId:string}>}) { return response(async()=>{ const params=await context.params; return ownerPayoutMutation(request,params.cleanerId,'void', params.paymentId); }); }
