import type { OnboardingState, OnboardingRole } from '../../contracts/onboarding';
export type Invite = { id:string; emailAddress:string; status:string; publicMetadata:Record<string,unknown>|null };
export type Evidence = { pendingOwnerCount:number; propertyInvitations:{id:string;status:'valid'|'expired'|'invalid'}[] };
export type Profile = { id:string; role:'admin'|'owner'|'cleaner'; displayName:string; cityId:string|null; homeBase:string|null; complete:boolean; assignedPropertyCount:number };
const blocked = (reason:Extract<OnboardingState,{status:'blocked'}>['reason']):OnboardingState => ({status:'blocked',reason,message: reason==='expired'?'Your invitation has expired. Ask the inviter for a new invitation.':reason==='revoked'?'Your invitation was revoked. Contact your Bloom admin.':reason==='conflicting'?'Your account has conflicting role invitations. Contact your Bloom admin.':'This invitation does not match your verified account. Contact your Bloom admin.'});
export function onboardingPolicy(profile:Profile|null,displayName:string,emails:string[],metadata:Record<string,unknown>,invites:Invite[],evidence:Evidence):OnboardingState {
 if(profile?.complete)return {status:'complete',role:profile.role,destination:`/${profile.role}`};
 const roles=new Set<OnboardingRole|'admin'>();let invited=false;
 const marker=metadata.bloomInvite;
 if(marker!==undefined){
  if(!marker||typeof marker!=='object')return blocked('invalid');
  const m=marker as Record<string,unknown>;
  if(typeof m.email!=='string'||!emails.includes(m.email.toLowerCase()))return blocked('mismatched');
  const marked=invites.filter(i=>{const x=i.publicMetadata?.bloomInvite as Record<string,unknown>|undefined;return x&&x.email===m.email&&x.key===m.key&&x.actor===m.actor&&x.role===m.role;});
  if(!marked.length)return blocked('invalid');
  if(!marked.some(i=>i.status==='pending'||i.status==='accepted'))return blocked(marked.some(i=>i.status==='revoked')?'revoked':marked.some(i=>i.status==='expired')?'expired':'invalid');
 }
 const matching=invites.filter(i=>emails.includes(i.emailAddress.toLowerCase()));
 const active=matching.filter(i=>i.status==='pending'||i.status==='accepted');
 if(!active.length&&matching.length){if(matching.some(i=>i.status==='revoked'))return blocked('revoked');if(matching.some(i=>i.status==='expired'))return blocked('expired');return blocked('invalid');}
 for(const invite of active){
  const m=invite.publicMetadata?.bloomInvite;
  const property=invite.publicMetadata?.bloomPropertyInvite;
  if(m&&typeof m==='object'){
   const x=m as Record<string,unknown>;
   if(typeof x.email!=='string'||x.email.toLowerCase()!==invite.emailAddress.toLowerCase()||typeof x.key!=='string'||!x.key||typeof x.actor!=='string'||!x.actor)return blocked('invalid');
   if(x.role!=='owner'&&x.role!=='cleaner'&&x.role!=='admin')return blocked('invalid');
   roles.add(x.role);invited=true;
  }else if(typeof property==='string'){
   const row=evidence.propertyInvitations.find(i=>i.id===property);
   if(!row||row.status!=='valid')return blocked(row?.status==='expired'?'expired':'invalid');
   roles.add('owner');invited=true;
  }else return blocked('invalid');
 }
 if(typeof metadata.bloomPropertyInvite==='string'){
  const row=evidence.propertyInvitations.find(i=>i.id===metadata.bloomPropertyInvite);
  if(!row||row.status!=='valid')return blocked(row?.status==='expired'?'expired':'invalid');
  roles.add('owner');invited=true;
 }
 if(evidence.propertyInvitations.length&&!evidence.propertyInvitations.some(i=>i.status==='valid'))return blocked(evidence.propertyInvitations.some(i=>i.status==='expired')?'expired':'invalid');
 if(evidence.pendingOwnerCount>0||evidence.propertyInvitations.some(i=>i.status==='valid')){roles.add('owner');invited=true;}
 if(profile){if(profile.role==='admin')return {status:'complete',role:'admin',destination:'/admin'};roles.add(profile.role);}
 if(roles.size>1)return blocked('conflicting');
 const role=roles.values().next().value as OnboardingRole|'admin'|undefined;
 if(role==='admin')return {status:'complete',role:'admin',destination:'/admin'};
 if(profile?.role==='owner'&&profile.assignedPropertyCount>0)invited=true;
 if(!role)return {status:'choose_role',displayName};
 return {status:'setup',displayName,role,invited,cityId:profile?.cityId??null,homeBase:profile?.homeBase??null,assignedPropertyCount:profile?.assignedPropertyCount??evidence.pendingOwnerCount};
}
