import type { CalendarReviewPage } from '@/contracts';
import { requireAdmin, authenticatedDatabase } from '@/server/auth/session';
import { databaseError } from '@/server/db/errors';
import { response, uuid } from '@/server/db/http';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return response(async () => {
    await requireAdmin();
    const { db } = await authenticatedDatabase();
    const cursor = new URL(request.url).searchParams.get('cursor');
    const { data, error } = await db.rpc('bloom_admin_property_calendar_review', {
      p_property: uuid((await context.params).id), p_cursor: cursor ? uuid(cursor) : null,
    });
    if (error) databaseError(error);
    return data as CalendarReviewPage;
  });
}
