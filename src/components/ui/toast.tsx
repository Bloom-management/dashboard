'use client';
import {useSyncExternalStore,type ReactNode} from 'react';
import {Toast} from '@base-ui/react/toast';
import './toast.css';

type ToastData={content?:ReactNode;source?:'action'|'notification'};
const mobileQuery='(max-width: 700px), (pointer: coarse)';
const subscribeMobile=(onChange:()=>void)=>{const query=window.matchMedia(mobileQuery);query.addEventListener('change',onChange);return()=>query.removeEventListener('change',onChange);};
/** Shared Bloom notification manager: add, update, close and promise. */
export const toast=Toast.createToastManager<ToastData>();
function ToastList(){
 const {toasts}=Toast.useToastManager<ToastData>();
 const mobile=useSyncExternalStore(subscribeMobile,()=>window.matchMedia(mobileQuery).matches,()=>true);
 return toasts.filter(item=>!mobile||item.data?.source==='action'||!!item.data?.content).map(item=><Toast.Root key={item.id} toast={item} className="bloom-toast" swipeDirection={item.data?.content?[]:['right','down']}>
  <Toast.Content className="bloom-toast-content">
   {item.type&&<span className={`bloom-toast-status ${item.type}`} aria-hidden="true">{item.type==='loading'?<span className="bloom-toast-spinner"/>:item.type==='success'?<span className="bloom-toast-logo"/>:item.type==='error'?'!':item.type==='warning'?'!':'i'}</span>}
   <div className="bloom-toast-copy"><Toast.Title className="bloom-toast-title"/>{item.description&&<Toast.Description className="bloom-toast-description"/>}{item.data?.content}{item.actionProps&&<Toast.Action {...item.actionProps} className="bloom-toast-action"/>}</div>
   <Toast.Close className="bloom-toast-close" aria-label="Dismiss notification"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></Toast.Close>
  </Toast.Content>
 </Toast.Root>);
}
export function Toaster(){return <Toast.Provider toastManager={toast} timeout={5000} limit={3}><Toast.Portal><Toast.Viewport className="bloom-toast-viewport"><ToastList/></Toast.Viewport></Toast.Portal></Toast.Provider>;}
