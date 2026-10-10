import {auth} from '@clerk/nextjs/server';
import {UserButton,SignOutButton} from '@clerk/nextjs';
import {redirect} from 'next/navigation';
import Link from 'next/link';
import {deviceId,pushRpc,type Delivery} from '../../../server/push/runtime';
import '../../../styles/bloom-cleaner.css';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{delivery?:string}>}){
 const {delivery}=await searchParams;const device=await deviceId();
 let item:Delivery|null=null;
 if(device&&delivery&&/^[a-f0-9-]{36}$/.test(delivery)){
  try{item=await pushRpc<Delivery|null>('bloom_push_delivery',{p_id:delivery,p_device:device});}catch{/* Preserve a usable destination during service downtime. */}
 }
 if(!item)return <main className="bloom-cleaner bloom-push-verification"><section className="bloom-push-card"><h1>Bloom notifications</h1><p>This notification is no longer available. Open your inbox for current updates.</p><Link className="bloom-button" href="/">Open Bloom</Link></section></main>;
 const identity=await auth();const returnTo=`/notifications/open?delivery=${delivery}`;
 if(!identity.userId)redirect(`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`);
 if(identity.userId===item.subject&&/^\/(admin|owner|cleaner)(\?[^#\\]*)?$/.test(item.content.url))redirect(item.content.url);
 return <main className="bloom-cleaner bloom-push-verification"><section className="bloom-push-card"><h1>Switch accounts to view this notification</h1><p>This alert belongs to another account linked to this device. Choose that account, then continue.</p><UserButton/><Link className="bloom-button" href={returnTo}>Continue</Link><SignOutButton redirectUrl={`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`}><button className="bloom-button secondary">Sign in with another account</button></SignOutButton><Link href="/">Return to Bloom</Link></section></main>;
}
