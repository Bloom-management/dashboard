import { response, uuid } from '@/server/db/http';
import { userRpc } from '@/server/db/rpc';
import { jobCleaners } from '@/server/jobs/cleaner-identities';
export const runtime = 'nodejs';
/** Completed cleaning report. The report RPC authorizes the caller; the cleaners who did the job are attached after. */
export async function GET(_request: Request, context: { params: Promise<{id: string}> }) {
  return response(async () => {
    const id = uuid((await context.params).id);
    const report = await userRpc<Record<string, unknown>>('bloom_cleaning_report', {p_job: id});
    return {...report, cleaners: await jobCleaners(id)};
  });
}
