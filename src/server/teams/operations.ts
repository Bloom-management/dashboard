import 'server-only';
import {clerkClient,currentUser as clerkCurrentUser} from '@clerk/nextjs/server';
import {authenticatedDatabase,currentUser} from '../auth/session';
import {privilegedDatabase} from '../db/privileged';
import {userRpc} from '../db/rpc';
import {BackendError,databaseError} from '../db/errors';
import {mutation,text,uuid,choice} from '../db/http';
import type {CleaningTeam,IncomingTeamInvitation,CleanerNetwork} from '@/contracts/cleaning-teams';

export async function verifiedTeamIdentity(){
 const {subject}=await authenticatedDatabase();
 let identity;try{identity=await clerkCurrentUser();}catch{throw new BackendError('SOURCE_UNAVAILABLE');}
 if(!identity||identity.id!==subject)throw new BackendError('UNAUTHENTICATED');
 const emails=identity.emailAddresses.filter(e=>e.verification?.status==='verified').map(e=>e.emailAddress.trim().toLowerCase());
 if(!emails.length)throw new BackendError('FORBIDDEN');
 return {subject,emails,name:(identity.fullName||identity.username||'Cleaner').replace(/[\p{Cc}\p{Cf}]/gu,'').trim().slice(0,100)||'Cleaner'};
}
export const cleaningTeam=(propertyId:string)=>userRpc<CleaningTeam>('bloom_property_team',{p_property:uuid(propertyId)});
export async function updateCleaningTeam(propertyId:string,request:Request){
 const {body,key}=await mutation(request,['action','data']);
 const action=choice(body.action,['settings','request_bloom','approve_bloom','remove','revoke','defaults','host_charge'] as const);
 if(!body.data||typeof body.data!=='object'||Array.isArray(body.data))throw new BackendError('VALIDATION_ERROR');
 return userRpc('bloom_property_team_action',{p_property:uuid(propertyId),p_action:action,p_data:body.data,p_key:key});
}
export async function privateJobAction(jobId:string,request:Request){
 const {body,key}=await mutation(request,['action','data']);
 const action=choice(body.action,['assign','request_bloom','approve_bloom','remove_assignment','set_compensation'] as const);
 if(!body.data||typeof body.data!=='object'||Array.isArray(body.data))throw new BackendError('VALIDATION_ERROR');
 return userRpc('bloom_private_job_action',{p_job:uuid(jobId),p_action:action,p_data:body.data,p_key:key});
}
export async function cleanerNetwork():Promise<CleanerNetwork>{
 const user=await currentUser();if(user.role!=='cleaner'&&user.role!=='admin')throw new BackendError('FORBIDDEN');
 return {enabled:user.bloomNetworkEnabled!==false,cityId:user.approvedCityId};
}
export async function updateCleanerNetwork(request:Request){
 const {body,key}=await mutation(request,['enabled','cityId']);
 if(typeof body.enabled!=='boolean')throw new BackendError('VALIDATION_ERROR');
 return userRpc('bloom_cleaner_network',{p_enabled:body.enabled,p_city:body.cityId==null?null:uuid(body.cityId),p_key:key});
}
export async function incomingTeamInvitations():Promise<{items:IncomingTeamInvitation[]}>{
 const identity=await verifiedTeamIdentity();
 const {data,error}=await privilegedDatabase().rpc('bloom_team_invites_incoming',{p_emails:identity.emails});if(error)databaseError(error);return data;
}
export async function acceptTeamInvitation(id:string,request:Request){
 const {body}=await mutation(request,['enabled','cityId']);
 if(body.enabled!==undefined&&typeof body.enabled!=='boolean')throw new BackendError('VALIDATION_ERROR');
 const identity=await verifiedTeamIdentity();
 // Acceptance grants a membership only; initial account completion remains in the welcome dialog.
 const {data,error}=await privilegedDatabase().rpc('bloom_team_invite_accept',{p_id:uuid(id),p_subject:identity.subject,p_emails:identity.emails,p_name:identity.name,p_network:body.enabled===true,p_city:body.cityId==null?null:uuid(body.cityId),p_complete:false});
 if(error)databaseError(error);return data;
}
export async function inviteTeamCleaner(propertyId:string,request:Request){
 const actor=await currentUser();const {body,key}=await mutation(request,['email']);
 const email=text(body.email,254).trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new BackendError('VALIDATION_ERROR');
 const created=await userRpc<{id:string}>('bloom_team_invite',{p_property:uuid(propertyId),p_email:email,p_key:key});
 const service=privilegedDatabase();const attempt=await service.rpc('bloom_team_invite_delivery',{p_actor:actor.id,p_id:created.id});if(attempt.error)databaseError(attempt.error);
 let result=attempt.data;
 if(result.status==='pending'){
  try{
   const client=await clerkClient();let prior:{id:string}|undefined;let offset=0;
   for(;;){
    const page=await client.invitations.getInvitationList({query:email,limit:100,offset});
    prior=page.data.find(i=>i.emailAddress.toLowerCase()===email&&i.publicMetadata?.bloomTeamInvite===created.id&&['pending','accepted'].includes(i.status));
    if(prior||offset+page.data.length>=page.totalCount)break;
    if(!page.data.length||offset>=1000)throw new BackendError('SOURCE_UNAVAILABLE');offset+=page.data.length;
   }
   const delivered=prior??await client.invitations.createInvitation({emailAddress:email,notify:true,ignoreExisting:true,expiresInDays:7,redirectUrl:new URL('/team-invitations',process.env.NEXT_PUBLIC_APP_URL!).href,publicMetadata:{bloomTeamInvite:created.id}});
   const saved=await service.rpc('bloom_team_invite_delivery',{p_actor:actor.id,p_id:created.id,p_lease:result.lease,p_delivery:delivered.id});if(saved.error)databaseError(saved.error);result=saved.data;
  }catch(error){if(error instanceof BackendError)throw error;throw new BackendError('SOURCE_UNAVAILABLE');}
 }
 return {id:result.id,status:result.status,expiresAt:result.expiresAt};
}
