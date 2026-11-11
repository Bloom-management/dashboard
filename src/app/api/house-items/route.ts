import {response,mutation,uuid,choice,integer,text} from '../../../server/db/http';
import {userRpc} from '../../../server/db/rpc';
export async function GET(request:Request){return response(()=>{const q=new URL(request.url).searchParams;return userRpc('bloom_house_items',{p_property:uuid(q.get('propertyId')),p_job:q.get('jobId')?uuid(q.get('jobId')):null});});}
export async function POST(request:Request){return response(async()=>{
 const {body,key}=await mutation(request,['propertyId','itemId','action','value','revision','jobId']);
 return userRpc('bloom_house_items',{p_property:uuid(body.propertyId),p_item:body.itemId?uuid(body.itemId):null,p_action:choice(body.action,['report','rename','remove','add_room_supply','add_shared_supply','add_room_maintenance','add_shared_maintenance']),p_value:body.value==null?null:text(body.value,200),p_revision:body.revision==null?null:integer(body.revision,0,2147483646),p_job:body.jobId?uuid(body.jobId):null,p_key:key});
});}
