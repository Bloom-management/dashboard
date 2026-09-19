import { dispatch } from '../../../server/db/dispatch';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<Record<string, string>> }) {
  return dispatch('cityRequest', request, await context.params);
}
