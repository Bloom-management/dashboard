/** Browser-only pending files. Scoped by authenticated actor/job; no signed URLs stored. */
let database: Promise<IDBDatabase> | undefined;
function open() {
  return database ??= new Promise((resolve,reject)=>{
    const request=indexedDB.open('bloom-pending-photos',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('queues');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>{database=undefined;reject(request.error);};
  });
}
export async function readPhotoDrafts<T>(key:string):Promise<T[]> {
  const db=await open();return new Promise((resolve,reject)=>{const request=db.transaction('queues').objectStore('queues').get(key);request.onsuccess=()=>resolve(request.result?.items??[]);request.onerror=()=>reject(request.error);});
}
export async function writePhotoDrafts(key:string,items:unknown[]) {
  const db=await open();return new Promise<void>((resolve,reject)=>{const transaction=db.transaction('queues','readwrite');const store=transaction.objectStore('queues');if(items.length)store.put({items},key);else store.delete(key);transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);});
}
