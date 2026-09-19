import { dispatch } from '@/server/db/dispatch';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
 return dispatch('propertyRename',request,await context.params);
}
