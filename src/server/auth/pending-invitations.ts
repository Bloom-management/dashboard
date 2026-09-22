import type {Role} from '../../contracts';
import {BackendError} from '../db/errors';
type Invite={id:string;emailAddress:string;status:string;createdAt:number;publicMetadata:Record<string,unknown>|null};
export function invitationRole(invite:Invite):Role|null{
 const meta=invite.publicMetadata?.bloomInvite as Record<string,unknown>|undefined;
 if(meta?.email!==invite.emailAddress.toLowerCase()||typeof meta.actor!=='string'||typeof meta.key!=='string')return null;
 return meta.role==='admin'||meta.role==='owner'||meta.role==='cleaner'?meta.role:null;
}
export function pendingPeople(invites:Invite[]){
 const seen=new Set<string>();return [...invites].sort((a,b)=>b.createdAt-a.createdAt).filter(invite=>{const email=invite.emailAddress.toLowerCase();if(invite.status!=='pending'||seen.has(email))return false;seen.add(email);return true;}).map(invite=>({id:invite.id,email:invite.emailAddress,role:invitationRole(invite),createdAt:invite.createdAt}));
}
export function resendRole(invite:Invite){const role=invitationRole(invite);if(invite.status!=='pending'||!role)throw new BackendError('INVALID_STATE');return role;}
