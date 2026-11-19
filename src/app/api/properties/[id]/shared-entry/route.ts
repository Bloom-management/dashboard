import {response,mutation,uuid} from '@/server/db/http';
import {userRpc} from '@/server/db/rpc';
// A room's house-wide shared entry (main door). The database validates and authorizes.
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return response(async()=>{const {body}=await mutation(request,['entryType','code','entryNotes','version']);return userRpc('bloom_house_shared_entry',{p_property:uuid((await params).id),p_input:body});});}
