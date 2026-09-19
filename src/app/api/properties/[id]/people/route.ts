import { response } from '../../../../../server/db/http';
import { propertyPeople,invitePropertyPerson } from '../../../../../server/owner/people';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){return response(async()=>propertyPeople((await params).id));}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return response(async()=>invitePropertyPerson((await params).id,request));}
