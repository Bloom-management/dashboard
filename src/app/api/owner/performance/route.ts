import { ownerPerformance } from '../../../../server/owner/operations';
import { response } from '../../../../server/db/http';
export async function GET(request: Request) { return response(() => ownerPerformance(request)); }
