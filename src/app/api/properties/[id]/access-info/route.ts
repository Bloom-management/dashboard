import {response,mutation,uuid} from '@/server/db/http';
import {userRpc} from '@/server/db/rpc';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){return response(async()=>userRpc('bloom_property_access_info',{p_property:uuid((await params).id)}));}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return response(async()=>{const {body}=await mutation(request,['entryType','code','entryNotes','parking','garageCode','parkingNotes','version']);return userRpc('bloom_property_access_info',{p_property:uuid((await params).id),p_input:body});});}
