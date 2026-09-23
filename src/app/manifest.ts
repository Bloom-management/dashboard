import type { MetadataRoute } from 'next';
export default function manifest():MetadataRoute.Manifest {
 return {
  id:'/',name:'Bloom Cleaning',short_name:'Bloom',description:'Bloom cleaning management',
  start_url:'/',scope:'/',display:'standalone',background_color:'#f6f3ec',theme_color:'#f6f3ec',
  icons:[
   {src:'/icons/bloom-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
   {src:'/icons/bloom-512.png',sizes:'512x512',type:'image/png',purpose:'any'},
   {src:'/icons/bloom-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'},
  ],
 };
}
