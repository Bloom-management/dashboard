import { response } from '../../../../../server/db/http';
import { acceptPropertyInvitation } from '../../../../../server/owner/people';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return response(async()=>acceptPropertyInvitation((await params).id,request));}
