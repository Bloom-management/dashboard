import { pendingPeople,resendRole } from '../../../../server/auth/pending-invitations';
import { adminIdentityClient } from '../../../../server/auth/admin-identity';
import { requireAdmin } from '../../../../server/auth/session';
import { privilegedDatabase } from '../../../../server/db/privileged';
import { mutation, response, text, choice } from '../../../../server/db/http';
import { BackendError } from '../../../../server/db/errors';
export const runtime='nodejs';
export async function POST(request:Request){
 return response(async()=>{
  const admin=await requireAdmin();
  const {body,key}=await mutation(request,['email','role','invitationId']);
  const email=text(body.email,254).trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new BackendError('VALIDATION_ERROR');
  let role=body.invitationId?null:choice(body.role,['owner','cleaner','admin'] as const);
  privilegedDatabase(); // Fail configuration checks before sending an invitation.
  const client=adminIdentityClient();
  try{
   const exact=[];let offset=0;
   for(;;){const page=await client.invitations.getInvitationList({query:email,limit:100,offset});exact.push(...page.data.filter(invite=>invite.emailAddress.toLowerCase()===email));offset+=page.data.length;if(!page.data.length||offset>=page.totalCount)break;}
   if(body.invitationId){
    const original=exact.find(invite=>invite.id===text(body.invitationId,200));
    if(!original)throw new BackendError('NOT_FOUND');role=resendRole(original);
   }
   const replay=exact.find(invite=>{
    const receipt=invite.publicMetadata?.bloomInvite as Record<string,unknown>|undefined;
    return receipt?.key===key&&receipt?.actor===admin.id&&receipt?.role===role&&receipt?.email===email;
   });
   if(replay)return {id:replay.id,status:replay.status,email,role};
   if(body.invitationId){
    if(exact.some(invite=>invite.status==='accepted'))throw new BackendError('CONFLICT');
    const users=await client.users.getUserList({emailAddress:[email],limit:1});if(users.data.length)throw new BackendError('CONFLICT');
    if(exact.some(invite=>invite.status==='pending'&&Date.now()-invite.createdAt<60000))throw new BackendError('CONFLICT');
   }else if(exact.some(invite=>invite.status==='pending'||invite.status==='accepted'))throw new BackendError('CONFLICT');
   const invite=await client.invitations.createInvitation({
    emailAddress:email,notify:true,ignoreExisting:!!body.invitationId,
    redirectUrl:new URL('/sign-up',process.env.NEXT_PUBLIC_APP_URL!).href,
    publicMetadata:{bloomInvite:{key,actor:admin.id,role,email}},
   });
   return {id:invite.id,status:invite.status,email,role};
  }catch(error){
   if(error instanceof BackendError)throw error;
   const status=(error as {status?:number}).status;
   if(status===422||status===409)throw new BackendError('CONFLICT');
   throw new BackendError('SOURCE_UNAVAILABLE');
  }
 });
}

export async function GET(){return response(async()=>{
 await requireAdmin();const client=adminIdentityClient();
 try{const invites=[];let offset=0;for(;;){const page=await client.invitations.getInvitationList({status:'pending',limit:100,offset});invites.push(...page.data);offset+=page.data.length;if(!page.data.length||offset>=page.totalCount)break;}return pendingPeople(invites);}catch{throw new BackendError('SOURCE_UNAVAILABLE');}
});}
