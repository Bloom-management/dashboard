import { response } from '@/server/db/http';
import { ownerPayoutDetail } from '@/server/payouts/operations';
export async function GET(_request:Request, context:{params:Promise<{cleanerId:string}>}) { return response(async()=>ownerPayoutDetail((await context.params).cleanerId)); }
