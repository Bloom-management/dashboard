import { response, mutation } from '@/server/db/http';
import { createScenario, scenarioCatalog } from '@/server/dev/scenarios';

export const runtime = 'nodejs';

export async function GET() {
  return response(scenarioCatalog);
}

export async function POST(request: Request) {
  return response(async () => {
    const { body } = await mutation(request, ['propertyId', 'cleanerId', 'step']);
    return createScenario(body);
  });
}
