import {BackendError} from '../db/errors';
import {integer,text,uuid} from '../db/http';
export function productUrl(value:unknown):string {
 if(typeof value!=='string'||value.length>2048)throw new BackendError('VALIDATION_ERROR');
 try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port||!url.hostname.includes('.')||url.hostname.endsWith('.local')||url.hostname.endsWith('.localhost'))throw new Error();return url.href;}catch{throw new BackendError('VALIDATION_ERROR');}
}
export function validatePurchase(input:Record<string,unknown>){
 const date=(value:unknown)=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new BackendError('VALIDATION_ERROR');};
 if(input.restockId!==undefined){uuid(input.restockId);date(input.restockedDate);return;}
 text(input.productName,200);integer(input.costCents,0,100000000);date(input.purchaseDate);
 if(input.restockedDate!=null)date(input.restockedDate);
 for(const key of ['productUrl','imageUrl'])if(input[key]!=null)input[key]=productUrl(input[key]);
}
