import {cleaningTeam,updateCleaningTeam} from '@/server/teams/operations';
import {response} from '@/server/db/http';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return response(async()=>cleaningTeam((await context.params).id));}
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return response(async()=>updateCleaningTeam((await context.params).id,request));}
