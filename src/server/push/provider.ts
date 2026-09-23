/** OneSignal receives subscription IDs, never Bloom roles, cities or Clerk IDs. */
export type SendResult={state:'accepted'|'pending'|'failed';providerId?:string;error?:'TRANSIENT'|'PROVIDER_REJECTED'|'SUBSCRIPTION_EXPIRED';invalid?:boolean};
export async function sendPush(input:{subscription:string;key:string;url:string;ttl:number;delivery?:string;verification?:boolean},fetcher:typeof fetch=fetch):Promise<SendResult>{
 const app=process.env.ONESIGNAL_APP_ID,key=process.env.ONESIGNAL_REST_API_KEY;
 if(!app||!key)throw new Error('Push provider is not configured');
 try{
  const response=await fetcher('https://api.onesignal.com/notifications?c=push',{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{Authorization:`Key ${key}`,'Content-Type':'application/json'},body:JSON.stringify({app_id:app,include_subscription_ids:[input.subscription],target_channel:'push',idempotency_key:input.key,headings:{en:'Bloom Cleaning'},contents:{en:input.verification?'Tap to finish enabling notifications on this device.':'Open Bloom to check your job notifications.'},url:input.url,ttl:Math.max(0,Math.min(60,input.ttl)),chrome_web_icon:new URL('/icons/bloom-192.png',input.url).href,...(input.delivery?{data:{bloom_delivery:input.delivery}}:{})})});
  if(response.status===429||response.status>=500)return {state:'pending',error:'TRANSIENT'};
  let body;try{body=await response.json();}catch{return response.ok?{state:'pending',error:'TRANSIENT'}:{state:'failed',error:'PROVIDER_REJECTED'};}
  const errors=body.errors;
  const invalid=errors?.invalid_player_ids?.includes(input.subscription)||errors?.invalid_subscription_ids?.includes(input.subscription)||(Array.isArray(errors)&&errors.some((e:unknown)=>typeof e==='string'&&e.includes('not subscribed')));
  if(invalid)return {state:'failed',error:'SUBSCRIPTION_EXPIRED',invalid:true};
  if(!response.ok)return {state:'failed',error:'PROVIDER_REJECTED'};
  if(typeof body.id==='string'&&/^[\da-f-]{36}$/i.test(body.id))return {state:'accepted',providerId:body.id};
  // No message ID means nobody was targeted (e.g. disabled/expired subscription).
  return {state:'failed',error:'SUBSCRIPTION_EXPIRED',invalid:true};
 }catch{return {state:'pending',error:'TRANSIENT'};}
}
