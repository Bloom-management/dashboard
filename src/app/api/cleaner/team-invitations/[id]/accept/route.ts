import {acceptTeamInvitation} from '@/server/teams/operations';
import {response} from '@/server/db/http';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return response(async()=>acceptTeamInvitation((await context.params).id,request));}
