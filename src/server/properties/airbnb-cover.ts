import {BackendError} from '../db/errors';
import {previewProduct} from '../supplies/product-preview';
export type PropertyCover={listingUrl:string|null;image:string|null;status:'none'|'extracted'|'manual'|'unavailable';revision:number;canEdit:boolean};
export function listingUrl(value:unknown):string|null{
 if(value===null||value==='')return null;
 if(typeof value!=='string'||value.length>2048)throw new BackendError('VALIDATION_ERROR');
 try{const url=new URL(value.trim());const match=url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?rooms\/([0-9]+)\/?$/i);
 if(url.protocol!=='https:'||!['airbnb.com','www.airbnb.com','m.airbnb.com'].includes(url.hostname)||url.username||url.password||url.port||!match)throw Error();
 return 'https://www.airbnb.com/rooms/'+match[1];}catch{throw new BackendError('VALIDATION_ERROR');}
}
export function coverUrl(value:unknown):string{
 if(typeof value!=='string'||value.length>2048)throw new BackendError('VALIDATION_ERROR');
 try{const url=new URL(value);if(url.protocol!=='https:'||!/^a[0-9]\.muscache\.com$/.test(url.hostname)||!/^\/(im\/)?pictures\//.test(url.pathname)||url.username||url.password||url.port)throw Error();
 return url.origin+url.pathname+'?im_w=720';}catch{throw new BackendError('VALIDATION_ERROR');}
}
export async function extractCover(url:string,preview:typeof previewProduct=previewProduct):Promise<string|null>{
 try{const result=await preview(url);return result.imageUrl?coverUrl(result.imageUrl):null;}catch{return null;}
}
