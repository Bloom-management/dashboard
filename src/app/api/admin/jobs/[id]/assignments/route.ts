import { response } from '@/server/db/http';
import { integrationRead } from '@/server/integration/reads';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){ return response(async()=>integrationRead('assignments',request,(await context.params).id)); }
