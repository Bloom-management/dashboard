import 'server-only';
import { currentUser } from '../auth/session';
import { BackendError } from '../db/errors';
import { serviceRpc } from './store';
import {propertyCalendarService,type PropertySourceHealth} from './property';
import type {OwnerSource} from '../../contracts/owner-hub';
import { ownerPropertyCalendarService } from './owner-property';

export async function ownerPropertyCalendar(propertyId: string) {
  const user = await currentUser();
  if(user.role==='admin') {
    const service=propertyCalendarService(propertyId,user.id,serviceRpc());
    const safe=(s:PropertySourceHealth):OwnerSource=>({id:s.id,propertyId:s.propertyId,provider:s.provider,enabled:s.enabled,lastSuccessAt:s.lastSuccessAt,lastAttemptAt:s.lastAttemptAt,message:s.errorMessage});
    return {list:async(cursor:string|null=null)=>{const page=await service.list(cursor);return {items:page.items.map(safe),nextCursor:page.nextCursor};},add:async(url:string,key:string,provider:'airbnb'|'vrbo'='airbnb')=>safe(await service.add(provider,url,key)),sync:service.sync};
  }
  if (user.role !== 'owner') throw new BackendError('FORBIDDEN');
  return ownerPropertyCalendarService(propertyId, user.id, serviceRpc());
}
