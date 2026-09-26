import {currentUser} from '@/server/auth/session';
import {incomingTeamInvitations} from '@/server/teams/operations';
import {response,mutation} from '../../../server/db/http';
import {userRpc} from '../../../server/db/rpc';
import {BackendError} from '../../../server/db/errors';
type InboxPage={items:{id:string;body:string;href:string;dismissible:boolean}[];total:number};
export async function GET(request:Request){return response(async()=>{
 const offset=Number(new URL(request.url).searchParams.get('offset')??0);if(!Number.isInteger(offset)||offset<0||offset>100000)throw new BackendError('VALIDATION_ERROR');
 const actor=await currentUser();
 // Match the authenticated identity's verified emails server-side, never a client user/email claim.
 const invitations=actor.role==='cleaner'?(await incomingTeamInvitations()).items.filter(item=>item.status==='pending'):[];
 const pending=invitations.map(item=>({id:`team-invite:${item.id}`,body:`You’ve been invited to clean ${item.propertyName}.`,href:'/team-invitations',dismissible:false}));
 const page=await userRpc<InboxPage>('bloom_notification_inbox',{p_offset:Math.max(0,offset-pending.length)});
 return {items:[...pending.slice(offset,offset+10),...page.items].slice(0,10),total:pending.length+page.total};
});}
export async function POST(request:Request){return response(async()=>{const {body}=await mutation(request,['id']);if(typeof body.id!=='string'||body.id.length>100)throw new BackendError('VALIDATION_ERROR');return userRpc('bloom_notification_dismiss',{p_id:body.id});});}
