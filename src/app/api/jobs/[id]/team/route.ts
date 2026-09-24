import {clerkClient} from '@clerk/nextjs/server';
import {response,uuid} from '../../../../../server/db/http';
import {currentUser} from '../../../../../server/auth/session';
import {privilegedDatabase} from '../../../../../server/db/privileged';
import {userRpc} from '../../../../../server/db/rpc';
import {BackendError,databaseError} from '../../../../../server/db/errors';
import type {CleanerJob} from '../../../../../contracts';
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){return response(async()=>{
 const user=await currentUser();if(user.role!=='admin'&&user.role!=='cleaner')throw new BackendError('FORBIDDEN');
 const id=uuid((await context.params).id),db=privilegedDatabase();
 const job=await db.from('jobs').select('checkout_date').eq('id',id).maybeSingle();if(job.error)databaseError(job.error);if(!job.data)throw new BackendError('NOT_FOUND');
 const date=job.data.checkout_date;
 const visible=await userRpc<CleanerJob[]>('bloom_jobs',{p_from:date,p_to:date});
 if(!visible.some(job=>job.id===id))throw new BackendError('FORBIDDEN');
 const team=await db.from('assignments').select('cleaner_id,users!cleaner_id(display_name,clerk_user_id)').eq('job_id',id).is('ended_at',null).order('slot');if(team.error)databaseError(team.error);
 const rows=(team.data??[]).map(row=>({id:row.cleaner_id,profile:row.users as unknown as {display_name:string|null;clerk_user_id:string}|null}));
 const names=new Map<string,string>();
 try{const subjects=rows.flatMap(row=>row.profile?.clerk_user_id?[row.profile.clerk_user_id]:[]);if(subjects.length){const client=await clerkClient();const profiles=await client.users.getUserList({userId:subjects,limit:100});for(const profile of profiles.data){const name=[profile.firstName,profile.lastName].filter(Boolean).join(' ').trim()||profile.username;if(name)names.set(profile.id,name);}}}catch{/* Saved display names remain available during provider outages. */}
 return rows.map(row=>({id:row.id,displayName:names.get(row.profile?.clerk_user_id??'')||row.profile?.display_name||'Cleaner'}));
 });}
