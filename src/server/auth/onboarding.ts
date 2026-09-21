import 'server-only';
import { clerkClient, currentUser as clerkCurrentUser } from '@clerk/nextjs/server';
import type { CompleteOnboardingInput, CompleteOnboardingResult, OnboardingState } from '../../contracts/onboarding';
import { authenticatedDatabase } from './session';
import { privilegedDatabase } from '../db/privileged';
import { BackendError, databaseError } from '../db/errors';
import { mutation, text, uuid } from '../db/http';
import { onboardingPolicy, type Evidence, type Invite, type Profile } from './onboarding-policy';
async function context(){
 const {db,subject}=await authenticatedDatabase();
 const profileResult=await db.rpc('bloom_onboarding_profile');if(profileResult.error)databaseError(profileResult.error);
 const profile=profileResult.data as Profile|null;
 if(profile?.complete)return {subject,profile,state:{status:'complete',role:profile.role,destination:`/${profile.role}`} as OnboardingState,primary:null,name:profile.displayName};
 let identity;
 try{identity=await clerkCurrentUser();}catch{throw new BackendError('SOURCE_UNAVAILABLE');}
 if(!identity||identity.id!==subject)throw new BackendError('UNAUTHENTICATED');
 const emails=identity.emailAddresses.filter(e=>e.verification?.status==='verified').map(e=>e.emailAddress.trim().toLowerCase());
 const primary=identity.emailAddresses.find(e=>e.id===identity.primaryEmailAddressId&&e.verification?.status==='verified')?.emailAddress.trim().toLowerCase()??null;
 const name=(identity.fullName||identity.username||'Account').replace(/[\p{Cc}\p{Cf}]/gu,'').trim().slice(0,100)||'Account';
 if(!emails.length)return {subject,profile,name,primary,state:{status:'blocked',reason:'mismatched',message:'Verify your account email before continuing.'} as OnboardingState};
 const evidenceResult=await privilegedDatabase().rpc('bloom_onboarding_evidence',{p_subject:subject,p_primary_email:primary,p_emails:emails});if(evidenceResult.error)databaseError(evidenceResult.error);
 const invitations=new Map<string,Invite>();
 try{
  const client=await clerkClient();
  for(const email of emails){for(const status of ['pending','accepted','revoked','expired'] as const){
   let offset=0;
   for(;;){
    const page=await client.invitations.getInvitationList({query:email,status,limit:100,offset});
    for(const i of page.data)if(i.emailAddress.toLowerCase()===email)invitations.set(i.id,i);
    offset+=page.data.length;if(offset>=page.totalCount)break;
    if(!page.data.length||offset>=1000)throw new Error('Invitation page unavailable');
   }
  }}
 }catch{throw new BackendError('SOURCE_UNAVAILABLE');}
 const state=onboardingPolicy(profile,name,emails,identity.publicMetadata,[...invitations.values()],evidenceResult.data as Evidence);
 if(state.status==='complete'&&state.role==='admin'&&!profile){
  const provisioned=await privilegedDatabase().rpc('bloom_provision_invited_admin',{p_subject:subject,p_name:name});
  if(provisioned.error)databaseError(provisioned.error);
 }
 return {subject,profile,name,primary,state};
}
export async function resolveOnboarding():Promise<OnboardingState>{return (await context()).state;}
export async function completeOnboarding(request:Request):Promise<CompleteOnboardingResult>{
 const {body,key}=await mutation(request,['role','cityId','homeBase']);
 let input:CompleteOnboardingInput;
 if(body.role==='cleaner'&&body.homeBase===undefined)input={role:'cleaner',cityId:uuid(body.cityId)};
 else if(body.role==='owner'&&body.cityId===undefined)input={role:'owner',homeBase:text(body.homeBase,100).trim()};
 else throw new BackendError('VALIDATION_ERROR');
 const ctx=await context();
 if(ctx.state.status==='blocked')throw new BackendError('FORBIDDEN');
 if((ctx.state.status==='setup'||ctx.state.status==='complete')&&ctx.state.role!==input.role)throw new BackendError('FORBIDDEN');
 const {data,error}=await privilegedDatabase().rpc('bloom_complete_onboarding',{p_subject:ctx.subject,p_role:input.role,p_city:input.role==='cleaner'?input.cityId:null,p_home_base:input.role==='owner'?input.homeBase:null,p_name:ctx.name,p_primary_email:ctx.primary,p_key:key});
 if(error)databaseError(error);
 return data as CompleteOnboardingResult;
}
