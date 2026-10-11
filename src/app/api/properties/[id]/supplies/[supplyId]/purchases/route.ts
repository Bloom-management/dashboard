import {integer,mutation,response,uuid} from '@/server/db/http';
import {userRpc} from '@/server/db/rpc';
import {validatePurchase} from '@/server/supplies/validation';
type Context={params:Promise<{id:string;supplyId:string}>};
export async function GET(request:Request,context:Context){return response(async()=>{const p=await context.params;return userRpc('bloom_supply_purchases',{p_property:uuid(p.id),p_supply:uuid(p.supplyId),p_offset:integer(Number(new URL(request.url).searchParams.get('offset')??0),0,100000)});});}
export async function POST(request:Request,context:Context){return response(async()=>{const p=await context.params;const {body,key}=await mutation(request,['productName','productUrl','imageUrl','costCents','purchaseDate','restockedDate','restockId']);validatePurchase(body);return userRpc('bloom_supply_purchases',{p_property:uuid(p.id),p_supply:uuid(p.supplyId),p_input:body,p_key:key});});}
