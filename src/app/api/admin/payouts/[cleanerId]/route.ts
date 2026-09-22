import { response } from '@/server/db/http';
import { payoutDetail } from '@/server/payouts/operations';
export async function GET(_request:Request, context:{params:Promise<{cleanerId:string}>}) { return response(async()=>payoutDetail((await context.params).cleanerId)); }
