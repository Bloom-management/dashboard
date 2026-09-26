import {inviteTeamCleaner} from '@/server/teams/operations';
import {response} from '@/server/db/http';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return response(async()=>inviteTeamCleaner((await context.params).id,request));}
