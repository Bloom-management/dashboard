import 'server-only';
import { adminIdentityClient } from '../auth/admin-identity';
import { authenticatedDatabase, currentUser, requireAdmin } from '../auth/session';
import { BackendError, databaseError } from '../db/errors';
import { uuid } from '../db/http';
import { ownerSourceFreshness, assignedJobDetail } from '../jobs/calendar-reads';
import { propertyEntryInstructions } from '../jobs/reads';

function cursor(request: Request) { const value = new URL(request.url).searchParams.get('cursor'); return value ? uuid(value) : null; }
export async function integrationRead(operation:string, request:Request, id?:string) {
 const {db}=await authenticatedDatabase();
 if(operation==='ownerFreshness') return ownerSourceFreshness(cursor(request));
 if(operation==='jobDetail') return assignedJobDetail(uuid(id));
 if(operation==='cities') { const {data,error}=await db.from('cities').select('id,name,active').eq('active',true).order('name');if(error)databaseError(error);return data; }
 if(operation==='instructions') return {instructions:await propertyEntryInstructions(uuid(id))};
 if(operation==='ownerProperties') { const user=await currentUser();if(user.role!=='owner'&&user.role!=='admin')throw new BackendError('FORBIDDEN');const {data,error}=await db.from('properties').select('id,name').order('name');if(error)databaseError(error);return data; }
 if(operation==='myCityRequest') {
  const user=await currentUser();if(user.role!=='cleaner')throw new BackendError('FORBIDDEN');
  const {data,error}=await db.from('city_change_requests').select('status,cities!requested_city_id(name)').eq('cleaner_id',user.id).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(error)databaseError(error);if(!data)return null; const city=data.cities as unknown as {name:string}|null;
  return {status:data.status,requestedCityName:city?.name??'Requested city'};
 }
 await requireAdmin();
 if(operation==='assignments') {
  const {data,error}=await db.from('assignments').select('id,users!cleaner_id(display_name)').eq('job_id',uuid(id)).is('ended_at',null).order('slot');if(error)databaseError(error);
  return (data??[]).map(row=>({id:row.id,cleanerName:(row.users as unknown as {display_name:string}|null)?.display_name||'Cleaner'}));
 }
 const after=cursor(request);
 if(operation==='users') {
  let query=db.from('users').select('id,role,display_name,approved_city_id,clerk_user_id,home_base,cities!approved_city_id(name)').order('id').limit(11);if(after)query=query.gt('id',after);
  const {data,error}=await query;if(error)databaseError(error);const rows=data??[];
  const emails=new Map<string,string>();
  if(rows.length)try{
   const identities=await adminIdentityClient().users.getUserList({userId:rows.slice(0,10).map(u=>u.clerk_user_id),limit:10});
   for(const identity of identities.data){
    const primary=identity.emailAddresses.find(email=>email.id===identity.primaryEmailAddressId);
    if(primary)emails.set(identity.id,primary.emailAddress);
   }
  }catch(error){
   if(error instanceof BackendError)throw error;
   throw new BackendError('SOURCE_UNAVAILABLE');
  }
  return {items:rows.slice(0,10).map(u=>({id:u.id,role:u.role,displayName:u.display_name||'Account',approvedCityId:u.approved_city_id,email:emails.get(u.clerk_user_id)??null,location:u.role==='cleaner'?(u.cities as unknown as {name:string}|null)?.name??null:u.home_base})),nextCursor:rows.length>10?rows[9].id:null};
 }
 if(operation==='cityRequests') {
  let query=db.from('city_change_requests').select('id,status,users!cleaner_id(display_name),cities!requested_city_id(name)').order('id').limit(101);if(after)query=query.gt('id',after);
  const {data,error}=await query;if(error)databaseError(error);const rows=data??[];
  return {items:rows.slice(0,100).map(r=>({id:r.id,status:r.status,cleanerName:(r.users as unknown as {display_name:string}|null)?.display_name||'Cleaner',requestedCityName:(r.cities as unknown as {name:string}|null)?.name||'Requested city'})),nextCursor:rows.length>100?rows[99].id:null};
 }
 if(operation==='adminProperties' || operation==='adminProperty') {
  const {data,error}=await db.rpc('bloom_admin_property_options',{p_id:operation==='adminProperty'?uuid(id):null,p_cursor:after});
  if(error)databaseError(error);
  if(operation==='adminProperty'){if(!data.items.length)throw new BackendError('NOT_FOUND');return data.items[0];}
  return data;
 }
 throw new BackendError('NOT_FOUND');
}
