import type { Role } from '../../contracts';
/** Input must come from Clerk's server-fetched publicMetadata, never browser metadata. */
export function invitedRole(metadata:unknown,email:string,verified:boolean):Role|null{
 if(!verified||!metadata||typeof metadata!=='object')return null;
 const invite=metadata as Record<string,unknown>;
 if(!['owner','cleaner','admin'].includes(String(invite.role))||typeof invite.key!=='string'||!invite.key||typeof invite.actor!=='string'||!invite.actor)return null;
 return invite.email===email.toLowerCase()?invite.role as Role:null;
}
