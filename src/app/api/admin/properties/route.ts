import { dispatch } from '../../../../server/db/dispatch';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<Record<string, string>> }) {
  return dispatch('properties', request, await context.params);
}
export async function POST(request: Request, context: { params: Promise<Record<string, string>> }) {
  return dispatch('propertyCreate', request, await context.params);
}
