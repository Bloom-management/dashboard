import https from 'node:https';
import dns from 'node:dns/promises';
import {publicAddress} from '../calendar/fetch';
import {productUrl} from './validation';

const decode=(value:string)=>value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>Number(n)<=0x10ffff?String.fromCodePoint(Number(n)):'');
export function parseProduct(html:string,base:string){
 const meta=new Map<string,string>();
 for(const tag of html.matchAll(/<meta\b[^>]*>/gi)){
  const attrs=new Map<string,string>();for(const a of tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))attrs.set(a[1].toLowerCase(),decode(a[2]??a[3]));
  const key=attrs.get('property')??attrs.get('name');if(key&&attrs.get('content'))meta.set(key.toLowerCase(),attrs.get('content')!);
 }
 const productName=(meta.get('og:title')??meta.get('twitter:title')??decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]??'')).trim().slice(0,200);
 let imageUrl:string|null=null;try{const image=meta.get('og:image')??meta.get('twitter:image');if(image)imageUrl=productUrl(new URL(image,base).href);}catch{}
 const price=meta.get('product:price:amount')??meta.get('og:price:amount');
 const currency=meta.get('product:price:currency')??meta.get('og:price:currency');
 const costCents=currency==='USD'&&price&&/^\d{1,7}(\.\d{1,2})?$/.test(price)?Math.round(Number(price)*100):null;
 return {productName,imageUrl,costCents:costCents!==null&&costCents<=100000000?costCents:null};
}
/** Public HTTPS only, pinned DNS, bounded response, no cookies, no redirects. */
export async function previewProduct(input:string){
 const url=productUrl(input);return parseProduct(await fetchPublicHtml(url),url);
}
/** Fetches a public HTML page with the same SSRF guards as product previews. */
export async function fetchPublicHtml(input:string,maxBytes=1048576){
 const url=new URL(productUrl(input));const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);
 try{
  const addresses=await Promise.race([dns.lookup(url.hostname,{all:true}),new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('timeout')),{once:true}))]);
  if(!addresses.length||addresses.some(a=>!publicAddress(a.address))||controller.signal.aborted)throw new Error('Unavailable');
  const address=addresses[0];
  const html=await new Promise<string>((resolve,reject)=>{
   const req=https.get(url,{agent:false,signal:controller.signal,headers:{Accept:'text/html','Accept-Encoding':'identity','User-Agent':'BloomProductPreview/1.0'},lookup:((_host:string,options:{all?:boolean},callback:(error:null,address:string|{address:string;family:number}[],family?:number)=>void)=>options.all?callback(null,[address]):callback(null,address.address,address.family)) as never},res=>{
    if(res.statusCode!==200||!res.headers['content-type']?.includes('text/html')||(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity')){res.destroy();reject(new Error('Unavailable'));return;}
    const chunks:Buffer[]=[];let size=0;
    res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>maxBytes){res.destroy();reject(new Error('Too large'));}else chunks.push(chunk);});
    res.on('error',reject);res.on('aborted',()=>reject(new Error('Incomplete')));res.on('end',()=>res.complete?resolve(Buffer.concat(chunks).toString('utf8')):reject(new Error('Incomplete')));
   });req.on('error',reject);
  });return html;
 }finally{clearTimeout(timer);}
}
