// Conditional calendar responses are validated after current-account authorization.
import { dispatch } from '../../../server/db/dispatch';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<Record<string, string>> }) {
  return dispatch('jobs', request, await context.params);
}
