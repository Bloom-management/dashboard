import { dispatch } from '../../../../../server/db/dispatch';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<Record<string, string>> }) {
  return dispatch('photos', request, await context.params);
}
