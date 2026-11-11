/* Bloom-native worker. No provider SDK, account identifiers, endpoints or private content in payloads. */
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
const validId=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const destination=id=>`/notifications/open?delivery=${id}`;
function database(){return new Promise((resolve,reject)=>{
 const request=indexedDB.open('bloom-push-receipts',1);
 request.onupgradeneeded=()=>request.result.createObjectStore('receipts',{keyPath:'id'});
 request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
async function receipt(id,done=false){
 const db=await database();
 try{return await new Promise((resolve,reject)=>{
  const transaction=db.transaction('receipts','readwrite'),store=transaction.objectStore('receipts');let claimed=false;
  const request=store.get(id);
  request.onsuccess=()=>{
   const previous=request.result;
   if(done||!previous||(previous.state!=='shown'&&Date.now()-previous.at>30000)){
    store.put({id,state:done?'shown':'processing',at:Date.now()});claimed=true;
   }
  };
  transaction.oncomplete=()=>resolve(claimed);transaction.onerror=()=>reject(transaction.error);
 });}finally{db.close();}
}
self.addEventListener('push',event=>{
 let payload;try{payload=event.data?.json();}catch{return;}
 if(!validId(payload?.delivery)||typeof payload.token!=='string'||!/^[a-f0-9]{64}$/.test(payload.token))return;
 event.waitUntil((async()=>{
  const {delivery,token}=payload;
  try{if(!await receipt(delivery))return;}catch{/* Notification tag still coalesces when IndexedDB is unavailable. */}
  let body='Open Bloom to check your notifications.';
  try{
   const response=await fetch('/api/push/display',{method:'POST',credentials:'include',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000),
    headers:{'Content-Type':'application/json','Idempotency-Key':delivery},body:JSON.stringify({delivery,token})});
   if(response.ok){const content=(await response.json()).data;if(typeof content?.body==='string')body=content.body;}
  }catch{/* No private content offline or without the device+delivery capabilities. */}
  await self.registration.showNotification('Bloom',{body,icon:'/icons/bloom-192.png',tag:`bloom-${delivery}`,renotify:false,data:{bloom:true,delivery}});
  try{await receipt(delivery,true);}catch{/* Receipt is best effort after display. */}
 })());
});
self.addEventListener('notificationclick',event=>{
 const id=event.notification.data?.delivery;if(!validId(id))return;
 event.notification.close();event.waitUntil(self.clients.openWindow(destination(id)));
});
