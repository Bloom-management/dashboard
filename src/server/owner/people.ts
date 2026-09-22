import 'server-only';
import { clerkClient, currentUser as clerkCurrentUser } from '@clerk/nextjs/server';
import { authenticatedDatabase,currentUser } from '../auth/session';
import { privilegedDatabase } from '../db/privileged';
import { BackendError,databaseError } from '../db/errors';
import { mutation,text,uuid } from '../db/http';
import type { PropertyPeople,IncomingPropertyInvitation } from '../../contracts/property-people';

async function verifiedIdentity(){
 const {subject}=await authenticatedDatabase();const identity=await clerkCurrentUser();
 if(!identity||identity.id!==subject)throw new BackendError('UNAUTHENTICATED');
 return {subject,emails:identity.emailAddresses.filter(e=>e.verification?.status==='verified').map(e=>e.emailAddress.trim().toLowerCase()),name:(identity.fullName||identity.username||'Owner').replace(/[\p{Cc}\p{Cf}]/gu,'').trim().slice(0,100)||'Owner'};
}
export async function propertyPeople(id:string):Promise<PropertyPeople>{
 const {db}=await authenticatedDatabase();const {data,error}=await db.rpc('bloom_property_people',{p_property:uuid(id)});if(error)databaseError(error);
 const members=data.members as {id:string;displayName:string;subject:string;location?:string|null}[];
 const images=new Map<string,string>();
 // A temporarily unavailable profile image must not break property access.
 try{const client=await clerkClient();for(let offset=0;offset<members.length;offset+=100){const users=await client.users.getUserList({userId:members.slice(offset,offset+100).map(m=>m.subject),limit:100});for(const user of users.data){const url=new URL(user.imageUrl);if(url.protocol==='https:')images.set(user.id,url.href);}}}catch{/* Initials remain available. */}
 return {...data,members:members.map(({id,displayName,subject,location})=>({id,displayName,location:location??null,imageUrl:images.get(subject)??null}))};
}
export async function invitePropertyPerson(id:string,request:Request){
 const user=await currentUser();const {body,key}=await mutation(request,['email','resend']);const email=text(body.email,254).trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new BackendError('VALIDATION_ERROR');
 const {db}=await authenticatedDatabase();
 if(body.resend===true){
  const people=await db.rpc('bloom_property_people',{p_property:uuid(id)});if(people.error)databaseError(people.error);
  const invite=(people.data as PropertyPeople).invitations.find(invite=>invite.email.toLowerCase()===email&&['pending','sent'].includes(invite.status)&&new Date(invite.expiresAt).getTime()>Date.now());
  if(!invite)throw new BackendError('NOT_FOUND');
  const client=await clerkClient();
  try{
   const prior=[];let offset=0;
   for(;;){const page=await client.invitations.getInvitationList({query:email,limit:100,offset});prior.push(...page.data.filter(item=>item.emailAddress.toLowerCase()===email&&item.publicMetadata?.bloomPropertyInvite===invite.id));offset+=page.data.length;if(!page.data.length||offset>=page.totalCount)break;}
   const replay=prior.find(item=>{const receipt=item.publicMetadata?.bloomPropertyResend as Record<string,unknown>|undefined;return receipt?.key===key&&receipt?.actor===user.id;});
   if(replay)return {id:invite.id,status:invite.status,expiresAt:invite.expiresAt};
   if(prior.some(item=>Date.now()-item.createdAt<60000))throw new BackendError('CONFLICT');
   await client.invitations.createInvitation({emailAddress:email,notify:true,ignoreExisting:true,expiresInDays:Math.max(1,Math.ceil((new Date(invite.expiresAt).getTime()-Date.now())/86400000)),redirectUrl:new URL('/invitations',process.env.NEXT_PUBLIC_APP_URL!).href,publicMetadata:{bloomPropertyInvite:invite.id,bloomPropertyResend:{key,actor:user.id}}});
   return {id:invite.id,status:invite.status,expiresAt:invite.expiresAt};
  }catch(error){if(error instanceof BackendError)throw error;throw new BackendError('SOURCE_UNAVAILABLE');}
 }
 const created=await db.rpc('bloom_property_invite',{p_property:uuid(id),p_email:email,p_key:key});if(created.error)databaseError(created.error);
 const service=privilegedDatabase();const attempt=await service.rpc('bloom_property_invite_delivery',{p_actor:user.id,p_id:created.data.id});if(attempt.error)databaseError(attempt.error);
 let result=attempt.data;
 if(result.status==='pending'){
  const client=await clerkClient();
  try{
   // Recover an uncertain delivery without generating a second email. Lease serializes sends.
   let prior:{id:string}|undefined;let offset=0;
   for(;;){const page=await client.invitations.getInvitationList({query:email,limit:100,offset});prior=page.data.find(i=>i.emailAddress.toLowerCase()===email&&i.publicMetadata?.bloomPropertyInvite===result.id&&['pending','accepted'].includes(i.status));if(prior||!page.data.length||offset+page.data.length>=page.totalCount)break;offset+=page.data.length;}
   const delivery=prior??await client.invitations.createInvitation({emailAddress:email,notify:true,ignoreExisting:true,expiresInDays:7,redirectUrl:new URL('/invitations',process.env.NEXT_PUBLIC_APP_URL!).href,publicMetadata:{bloomPropertyInvite:result.id}});
   const saved=await service.rpc('bloom_property_invite_delivery',{p_actor:user.id,p_id:result.id,p_lease:result.lease,p_delivery:delivery.id});if(saved.error)databaseError(saved.error);result=saved.data;
  }catch(error){if(error instanceof BackendError)throw error;throw new BackendError('SOURCE_UNAVAILABLE');}
 }
 return {id:result.id,status:result.status,expiresAt:result.expiresAt};
}
export async function incomingPropertyInvitations():Promise<IncomingPropertyInvitation[]>{
 const identity=await verifiedIdentity();const {data,error}=await privilegedDatabase().rpc('bloom_property_invites_incoming',{p_emails:identity.emails});if(error)databaseError(error);return data;
}
export async function acceptPropertyInvitation(id:string,request:Request){
 await mutation(request,[]);const identity=await verifiedIdentity();const {data,error}=await privilegedDatabase().rpc('bloom_property_invite_accept',{p_id:uuid(id),p_subject:identity.subject,p_emails:identity.emails,p_name:identity.name});if(error)databaseError(error);return data as {propertyId:string;role:'owner'|'admin'};
}
