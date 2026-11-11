import {response,mutation,uuid,integer} from '../../../../../server/db/http';
import {userRpc} from '../../../../../server/db/rpc';
import {BackendError} from '../../../../../server/db/errors';
import {listingUrl,coverUrl,extractCover,type PropertyCover} from '../../../../../server/properties/airbnb-cover';
type Context={params:Promise<{id:string}>};
export const runtime='nodejs';
export async function GET(_request:Request,context:Context){return response(async()=>userRpc<PropertyCover>('bloom_property_airbnb',{p_property:uuid((await context.params).id)}));}
export async function POST(request:Request,context:Context){return response(async()=>{
 const {body,key}=await mutation(request,['listingUrl','manualImageUrl','revision']),id=uuid((await context.params).id);
 const current=await userRpc<PropertyCover>('bloom_property_airbnb',{p_property:id});
 if(!current.canEdit)throw new BackendError('NOT_FOUND');
 const revision=integer(body.revision,0,2147483646);
 const url=listingUrl(body.listingUrl),manual=body.manualImageUrl==null||body.manualImageUrl===''?null:coverUrl(body.manualImageUrl);
 if(manual&&!url)throw new BackendError('VALIDATION_ERROR');
 // Let the database replay a completed request before checking its revision.
 // A stale request with no receipt fails there without fetching Airbnb again.
 const image=url?(manual??(revision===current.revision?await extractCover(url):null)):null;
 return userRpc<PropertyCover>('bloom_property_airbnb',{p_property:id,p_write:true,p_url:url,p_image:image,p_status:!url?'none':manual?'manual':image?'extracted':'unavailable',p_revision:revision,p_key:key});
});}
