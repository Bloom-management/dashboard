/** Preparing a worker never prompts, subscribes or links an account. */
let preparing:Promise<ServiceWorkerRegistration>|undefined;
export function prepareNativeWorker(){
 if(!preparing)preparing=navigator.serviceWorker.register('/bloom-push/worker.js',{scope:'/bloom-push/'}).then(async registration=>{
  if(registration.active)return registration;
  await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Worker unavailable')),15000);
   const check=()=>{if(registration.active){clearTimeout(timer);resolve();}};
   const worker=registration.installing??registration.waiting;
   if(worker)worker.addEventListener('statechange',check);else{clearTimeout(timer);reject(Error('Worker unavailable'));}check();
  });return registration;
 }).catch(error=>{preparing=undefined;throw error;});
 return preparing;
}
export function requestNativePermission(){return Notification.permission==='default'?Notification.requestPermission():Promise.resolve(Notification.permission);}
export async function nativeSubscription(publicKey:string){
 const registration=await prepareNativeWorker();const existing=await registration.pushManager.getSubscription();
 const raw=atob(publicKey.replaceAll('-','+').replaceAll('_','/'));const applicationServerKey=Uint8Array.from(raw,c=>c.charCodeAt(0));
 if(existing){
  const key=existing.options.applicationServerKey;
  if(key&&new Uint8Array(key).toString()===applicationServerKey.toString())return existing.toJSON();
  // A key rotation needs a new subscription, never silently replace the OneSignal worker.
  await existing.unsubscribe();
 }
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const subscription=await Promise.race([registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Subscription unavailable')),30000);})]);
  return subscription.toJSON();
 }finally{clearTimeout(timer);}
}
