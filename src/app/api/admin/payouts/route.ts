import { response } from '@/server/db/http';
import { payoutSummary } from '@/server/payouts/operations';
export async function GET() { return response(payoutSummary); }
