 'use client';
import {StartupBoundary} from './startup/startup-boundary';
import { useMemo } from 'react';
import { useAuth, UserButton } from '@clerk/nextjs';
import { request, ApiError } from './api';
import { CleanerHub } from './cleaner';
import { OwnerHub } from './owner';
import { AdminHub } from './admin';
import type { AdminPerson, BloomIntegration, CityOption, CityRequest, Page, PropertyOption, SourceHealth } from './integration';
import type { Role } from '../../contracts';
function query(cursor:string|null) { return cursor?`?${new URLSearchParams({cursor})}`:''; }
export function ConnectedHub({role,initialPropertyId}:{role:Role;initialPropertyId?:string}) {
 const {getToken}=useAuth();
 const integration=useMemo<BloomIntegration>(()=>({
  accountControl:()=> <UserButton/>,
  renameProperty:(propertyId,name,key)=>request<{id:string;name:string}>(`/properties/${encodeURIComponent(propertyId)}/rename`,{body:{name},key}),
  listCities:signal=>request<CityOption[]>('/cities',{signal}),
  getMyCityRequest:signal=>request('/city-change-requests/current',{signal}),
  getInstructions:(jobId,signal)=>request(`/jobs/${encodeURIComponent(jobId)}/details`,{signal}),
  ownerFreshness:async signal=>{
   const rows:{propertyId:string;lastSuccessAt:string|null;message:string|null}[]=[];
   let cursor:string|null=null;
   for(;;){
    const page:typeof rows=await request<typeof rows>(`/owner/freshness${query(cursor)}`,{signal});
    rows.push(...page);if(page.length<100)return rows;
    const next:string=page[page.length-1].propertyId;
    if(cursor!==null&&next<=cursor)throw new ApiError('CONFIGURATION_ERROR','Calendar freshness could not be loaded.');
    cursor=next;
   }
  },
  ownerProperties:signal=>request('/owner/properties',{signal}),
  prepareUpload:async(jobId,category,file,key,signal,roomId)=>{
   const target=await request<{photoId:string;bucket:'job-photos';path:string}>(`/jobs/${encodeURIComponent(jobId)}/photos/upload`,{body:{category,mime:file.type,bytes:file.size,...(roomId?{roomId}:{})},key,signal});
   return {photoId:target.photoId,upload:async(bytes,progress,abort)=>{
    const token=await getToken();const base=process.env.NEXT_PUBLIC_SUPABASE_URL;const publicKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if(!token)throw new ApiError('UNAUTHENTICATED','Sign in to upload photos.');
    if(!base||!publicKey||publicKey.startsWith('replace_'))throw new ApiError('CONFIGURATION_ERROR','Photo storage is not configured.');
    const url=new URL(`/storage/v1/object/${encodeURIComponent(target.bucket)}/${target.path.split('/').map(encodeURIComponent).join('/')}`,base);
    await new Promise<void>((resolve,reject)=>{
     const xhr=new XMLHttpRequest();const cancel=()=>xhr.abort();const finish=(error?:unknown)=>{abort.removeEventListener('abort',cancel);if(error)reject(error);else resolve();};
     xhr.open('POST',url);xhr.timeout=60000;xhr.setRequestHeader('Authorization',`Bearer ${token}`);xhr.setRequestHeader('apikey',publicKey);xhr.setRequestHeader('Content-Type',bytes.type);xhr.setRequestHeader('x-upsert','false');
     xhr.upload.onprogress=e=>{if(e.lengthComputable)progress(Math.round(e.loaded/e.total*100));};
     xhr.onload=()=>{if(xhr.status>=200&&xhr.status<300){progress(100);finish();return;}
      // Insert-only retry may encounter an object already uploaded before a lost response.
      // Server finalization still verifies identity, size, decoded bytes and assignment.
      let duplicate=false;try{const body=JSON.parse(xhr.responseText);duplicate=body.error==='Duplicate'||body.code==='Duplicate';}catch{}
      if(xhr.status===409&&duplicate){progress(100);finish();}else finish(new ApiError(xhr.status===401?'UNAUTHENTICATED':xhr.status===403?'FORBIDDEN':'INVALID_STATE','Photo upload failed. Retry or contact your admin.'));};
     xhr.onerror=()=>finish(new ApiError('NETWORK_ERROR','Photo upload interrupted. Retry the upload.'));xhr.ontimeout=xhr.onerror;xhr.onabort=()=>finish(new DOMException('Aborted','AbortError'));
     if(abort.aborted){finish(new DOMException('Aborted','AbortError'));return;}abort.addEventListener('abort',cancel,{once:true});xhr.send(bytes);
    });
   }};
  },
  admin:{
   property:async(id,signal)=>{const property=await request<PropertyOption>(`/admin/properties/${encodeURIComponent(id)}`,{signal});return {...property,pendingOwnerEmail:property.pendingOwnerEmail??null};},
   propertySources:(id,cursor,signal)=>request<Page<SourceHealth>>(`/admin/properties/${encodeURIComponent(id)}/calendar-sources${query(cursor)}`,{signal}),
   properties:async(cursor,signal)=>{const page=await request<Page<PropertyOption>>(`/admin/property-options${query(cursor)}`,{signal});return {...page,items:page.items.map(property=>({...property,pendingOwnerEmail:property.pendingOwnerEmail??null}))};},
   users:(cursor,signal)=>request<Page<AdminPerson>>(`/admin/users${query(cursor)}`,{signal}),
   cityRequests:(cursor,signal)=>request<Page<CityRequest>>(`/admin/city-change-requests${query(cursor)}`,{signal}),
   resolveCityRequest:async(id,decision,key)=>{await request(`/admin/city-change-requests/${encodeURIComponent(id)}/resolve`,{body:{decision},key});},
   sources:async(cursor,signal)=>{const page=await request<Page<SourceHealth & {action:string|null}>>(`/admin/calendar/sources${query(cursor)}`,{signal});return {...page,items:page.items.map(s=>({...s,errorMessage:s.action}))};},
   createProperty:async(property,key)=>{const {active:_active,...body}=property;return request<{id:string}>('/admin/properties',{body,key});},
   assignments:(jobId,signal)=>request(`/admin/jobs/${encodeURIComponent(jobId)}/assignments`,{signal}),
  }
 }),[getToken]);
 return <StartupBoundary>{role==='cleaner'?<CleanerHub integration={integration}/>:role==='owner'?<OwnerHub integration={integration}/>:<AdminHub integration={integration} initialPropertyId={initialPropertyId}/>}</StartupBoundary>;
}
