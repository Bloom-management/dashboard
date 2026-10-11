import {mutation,response,uuid} from '@/server/db/http';
import {userRpc} from '@/server/db/rpc';
import {previewProduct} from '@/server/supplies/product-preview';
import {productUrl} from '@/server/supplies/validation';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string;supplyId:string}>}){return response(async()=>{
 const p=await context.params;const {body}=await mutation(request,['url']);
 await userRpc('bloom_supply_purchases',{p_property:uuid(p.id),p_supply:uuid(p.supplyId)});
 const url=productUrl(body.url);
 try{return {...await previewProduct(url),available:true};}catch{return {available:false,productName:'',imageUrl:null,costCents:null};}
});}
