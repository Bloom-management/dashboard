export type PushSDK={init:(options:Record<string,unknown>)=>Promise<void>;Notifications:{requestPermission:()=>Promise<void>;isPushSupported:()=>boolean};User:{PushSubscription:{id?:string;optedIn:boolean;optIn:()=>Promise<void>;optOut:()=>Promise<void>}}};
declare global {interface Window{OneSignalDeferred?:((sdk:PushSDK)=>void)[];}}
let loading:Promise<PushSDK>|undefined;
export function loadPush(appId:string){
 if(!loading)loading=new Promise<PushSDK>((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Notification service timed out. Try again.')),15000);
  window.OneSignalDeferred=window.OneSignalDeferred||[];
  window.OneSignalDeferred.push(async sdk=>{try{await sdk.init({appId,serviceWorkerPath:'push/OneSignalSDKWorker.js',serviceWorkerParam:{scope:'/push/'},autoResubscribe:false,notifyButton:{enable:false},welcomeNotification:{disable:true},promptOptions:{slidedown:{prompts:[{type:'push',autoPrompt:false}]}}});clearTimeout(timer);resolve(sdk);}catch(error){clearTimeout(timer);reject(error);}});
  const script=document.createElement('script');script.src='https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';script.defer=true;script.onerror=()=>{clearTimeout(timer);reject(new Error('Notification service could not load.'));};document.head.appendChild(script);
 });
 return loading;
}
export function deviceSupport(){
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const installed=window.matchMedia('(display-mode: standalone)').matches||('standalone' in navigator&&navigator.standalone===true);
 return {ios,installed,supported:window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window};
}
