import {currentUser} from '@/server/auth/session';
import {incomingTeamInvitations} from '@/server/teams/operations';
import {response,mutation} from '../../../server/db/http';
import {userRpc} from '../../../server/db/rpc';
import {BackendError} from '../../../server/db/errors';
import {mergeNotificationPage,type InboxPage} from '@/server/notifications/inbox';
export async function GET(request:Request){return response(async()=>{
 const offset=Number(new URL(request.url).searchParams.get('offset')??0);if(!Number.isInteger(offset)||offset<0||offset>100000)throw new BackendError('VALIDATION_ERROR');
 const actor=await currentUser();
 // Match the authenticated identity's verified emails server-side, never a client user/email claim.
 const invitations=actor.role==='cleaner'?(await incomingTeamInvitations()).items.filter(item=>item.status==='pending'):[];
 const pending=invitations.map(item=>({id:`team-invite:${item.id}`,body:`You’ve been invited to clean ${item.propertyName}.`,href:'/team-invitations',dismissible:false,createdAt:item.createdAt}));
 return mergeNotificationPage(offset,pending,p_offset=>userRpc<InboxPage>('bloom_notification_inbox',{p_offset}));
});}
export async function POST(request:Request){return response(async()=>{const {body}=await mutation(request,['id','all']);if(body.all===true){if(body.id!==undefined)throw new BackendError('VALIDATION_ERROR');const ids:string[]=[];for(let offset=0;;offset+=10){const page=await userRpc<InboxPage>('bloom_notification_inbox',{p_offset:offset});ids.push(...page.items.filter(item=>item.dismissible).map(item=>item.id));if(!page.items.length||offset+page.items.length>=page.total)break;}for(const id of ids)await userRpc('bloom_notification_dismiss',{p_id:id});return {cleared:ids.length};}if(typeof body.id!=='string'||body.id.length>100)throw new BackendError('VALIDATION_ERROR');return userRpc('bloom_notification_dismiss',{p_id:body.id});});}
