import { response } from '@/server/db/http';
import { ownerPayoutSummary } from '@/server/payouts/operations';
export async function GET() { return response(ownerPayoutSummary); }
