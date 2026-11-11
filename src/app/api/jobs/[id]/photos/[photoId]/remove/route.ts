import {response,mutation,uuid} from '../../../../../../../server/db/http';
import {userRpc} from '../../../../../../../server/db/rpc';
export async function POST(request:Request,context:{params:Promise<{id:string;photoId:string}>}){
 return response(async()=>{const {key}=await mutation(request,[]),params=await context.params;
 return userRpc('bloom_note_photo_remove',{p_job:uuid(params.id),p_photo:uuid(params.photoId),p_key:key});});
}
