import {ApiError} from './api';
/** Resize camera images before transfer so phone photos fit the server's limits. */
export async function preparePhotoFile(file:File):Promise<File>{
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||!file.size)throw new ApiError('VALIDATION_ERROR','Choose a JPEG, PNG, or WebP photo. For HEIC photos, export or share them as JPEG first.');
 if(file.size>40*1024*1024)throw new ApiError('VALIDATION_ERROR','Choose a photo smaller than 40 MB.');
 const bitmap=await createImageBitmap(file);
 try{
  if(file.size<=2*1024*1024&&bitmap.width<=2560&&bitmap.height<=2560)return file;
  const scale=Math.min(1,2560/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const context=canvas.getContext('2d');if(!context)throw new Error('Image conversion unavailable');
  context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Image conversion failed')),'image/jpeg',0.85));
  if(blob.size>10*1024*1024)throw new ApiError('VALIDATION_ERROR','This photo is still too large. Choose a smaller image.');
  return new File([blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg',lastModified:file.lastModified});
 }finally{bitmap.close();}
}
