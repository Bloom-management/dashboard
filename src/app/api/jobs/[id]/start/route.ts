import { response, mutation, uuid } from '@/server/db/http';
import { userRpc } from '@/server/db/rpc';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{id: string}> }) {
  return response(async () => { const {key} = await mutation(request, []); return userRpc('bloom_job_start', {p_job: uuid((await context.params).id), p_key:key}); });
}
