import { response } from '@/server/db/http';
import { cleanerPayouts } from '@/server/payouts/operations';
export async function GET() { return response(cleanerPayouts); }
