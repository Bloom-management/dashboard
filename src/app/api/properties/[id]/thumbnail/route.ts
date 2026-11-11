import sharp from 'sharp';
import {response,mutation,uuid} from '@/server/db/http';
import {userRpc} from '@/server/db/rpc';
import {BackendError} from '@/server/db/errors';
export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,context:Context){return response(async()=>{
 const id=uuid((await context.params).id);
 return userRpc('bloom_property_airbnb',{p_property:id});
});}
export async function POST(request:Request,context:Context){return response(async()=>{
 const id=uuid((await context.params).id);const {body,key}=await mutation(request,['image']);let image:string|null=null;
 if(body.image!==null){
 if(typeof body.image!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(body.image))throw new BackendError('VALIDATION_ERROR');
 try{const bytes=await sharp(Buffer.from(body.image.split(',')[1],'base64'),{limitInputPixels:1_000_000,failOn:'warning'}).rotate().resize(160,160,{fit:'cover'}).jpeg({quality:70}).toBuffer();image=`data:image/jpeg;base64,${bytes.toString('base64')}`;}catch{throw new BackendError('VALIDATION_ERROR');}
 }
 return userRpc('bloom_property_thumbnail',{p_property:id,p_image:image,p_key:key});
});}
