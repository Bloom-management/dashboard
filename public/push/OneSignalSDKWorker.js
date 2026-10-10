// This worker only handles push; activate fixes without waiting for open app windows.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
const bloomDestination=path=>typeof path==='string'&&(/^(?:\/(?:cleaner|owner|admin)(?:\?[^#\\]*)?)$/.test(path)||/^\/notifications\/open\?delivery=[a-f0-9-]{36}$/.test(path))?path:null;
/* Register before OneSignal: Bloom messages use an authenticated display check.
   Non-Bloom notifications retain the provider's standard behavior. */
self.addEventListener('push',event=>{
 let payload;try{payload=event.data?.json();}catch{return;}
 let custom;try{custom=typeof payload?.custom==='string'?JSON.parse(payload.custom):payload?.custom;}catch{return;}
 const delivery=custom?.a?.bloom_delivery;
 if(typeof delivery!=='string')return;
 event.stopImmediatePropagation();
 event.waitUntil((async()=>{
  let body='Open Bloom to check your notifications.',url=bloomDestination(`/notifications/open?delivery=${delivery}`)||'/';
  try{
   const result=await fetch('/api/push/display',{method:'POST',credentials:'include',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','Idempotency-Key':delivery},body:JSON.stringify({delivery})});
   if(result.ok){const value=(await result.json()).data;if(typeof value?.body==='string'&&typeof value?.url==='string'&&bloomDestination(value.url)){body=value.body;url=value.url;}}
  }catch{/* Offline or revoked device: display only a generic fallback. */}
  // Always display a visible, non-sensitive fallback; Safari forbids silent pushes.
  await self.registration.showNotification('Bloom',{body,icon:'/icons/bloom-192.png',tag:`bloom-${delivery}`,data:{bloom:true,url}});
 })());
});
self.addEventListener('notificationclick',event=>{
 if(!event.notification.data?.bloom)return;
 event.stopImmediatePropagation();event.notification.close();
 const path=event.notification.data.url;
 event.waitUntil(self.clients.openWindow(bloomDestination(path)||'/'));
});
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
