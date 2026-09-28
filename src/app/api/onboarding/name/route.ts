import {clerkClient} from '@clerk/nextjs/server';
import {authenticatedDatabase} from '../../../../server/auth/session';
import {profileName} from '../../../../server/auth/profile-name';
import {privilegedDatabase} from '../../../../server/db/privileged';
import {BackendError,databaseError} from '../../../../server/db/errors';
import {mutation,response} from '../../../../server/db/http';
export const runtime='nodejs';
export async function POST(request:Request){return response(async()=>{
 const {body}=await mutation(request,['name']);
 const {subject}=await authenticatedDatabase();
 const name=profileName(body.name);if(!name)throw new BackendError('VALIDATION_ERROR');
 const [firstName,...remaining]=name.split(' ');
 const client=await clerkClient();
 await client.users.updateUser(subject,{firstName,lastName:remaining.join(' ')});
 const db=privilegedDatabase();
 const result=await db.from('users').update({display_name:name}).eq('clerk_user_id',subject);
 if(result.error)databaseError(result.error);
 return {displayName:name};
});}
