import {response,mutation,uuid,choice,integer} from '../../../server/db/http';
import {userRpc} from '../../../server/db/rpc';
export async function GET(){return response(()=>userRpc('bloom_listing_drafts'));}
export async function POST(request:Request){return response(async()=>{
 const {body,key}=await mutation(request,['id','action','data','revision','cityId','listingType','houseId']);
 if(body.action==='create')return userRpc('bloom_listing_draft_create',{p_city:uuid(body.cityId),p_type:choice(body.listingType,['room','entire_home']),p_data:body.data,p_key:key,p_house:body.houseId?uuid(body.houseId):null});
 return userRpc('bloom_listing_drafts',{p_id:uuid(body.id),p_action:choice(body.action,['save','discard','activate']),p_data:body.data??null,p_revision:integer(body.revision,0,2147483646),p_key:key});
});}
