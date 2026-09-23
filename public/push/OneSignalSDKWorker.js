/* Register before OneSignal: Bloom messages use an authenticated display check.
   Non-Bloom notifications retain the provider's standard behavior. */
self.addEventListener('push',event=>{
 let payload;try{payload=event.data?.json();}catch{return;}
 let custom;try{custom=typeof payload?.custom==='string'?JSON.parse(payload.custom):payload?.custom;}catch{return;}
 const delivery=custom?.a?.bloom_delivery;
 if(typeof delivery!=='string')return;
 event.stopImmediatePropagation();
 event.waitUntil((async()=>{
  let body='Open Bloom to check your notifications.',url='/cleaner';
  try{
   const result=await fetch('/api/push/display',{method:'POST',credentials:'include',cache:'no-store',signal:AbortSignal.timeout(4000),headers:{'Content-Type':'application/json','Idempotency-Key':delivery},body:JSON.stringify({delivery})});
   if(result.ok){const value=(await result.json()).data;if(typeof value?.body==='string'&&typeof value?.url==='string'&&value.url.startsWith('/cleaner?')){body=value.body;url=value.url;}}
  }catch{/* Offline, signed out or switched accounts: never expose the previous user's counts. */}
  // Always display a visible, non-sensitive fallback; Safari forbids silent pushes.
  await self.registration.showNotification('Bloom Cleaning',{body,icon:'/icons/bloom-192.png',tag:`bloom-${delivery}`,data:{bloom:true,url}});
 })());
});
self.addEventListener('notificationclick',event=>{
 if(!event.notification.data?.bloom)return;
 event.stopImmediatePropagation();event.notification.close();
 const path=event.notification.data.url;
 event.waitUntil(self.clients.openWindow(typeof path==='string'&&path.startsWith('/cleaner')?path:'/cleaner'));
});
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
