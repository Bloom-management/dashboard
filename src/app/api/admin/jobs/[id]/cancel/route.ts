import { dispatch } from '../../../../../../server/db/dispatch';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<Record<string, string>> }) {
  return dispatch('cancel', request, await context.params);
}
