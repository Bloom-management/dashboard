import type {CalendarReviewEntry} from '../../contracts';
import type {OwnerAnalyticsInput} from '../../contracts/owner-hub';
export function adminAnalyticsEvent(propertyId:string,event:CalendarReviewEntry):OwnerAnalyticsInput['events'][number]{
 const verified=event.kind==='reservation'&&event.evidence==='airbnb-reservation-link'&&!event.reviewRequired&&!event.manualReturn;
 return {id:event.id,propertyId,startDate:event.startDate,endDate:event.endDate,kind:event.manualReturn==='ambiguous'?'unknown':event.kind,removed:event.status==='removed'||event.manualReturn==='confirmed',confirmed:verified,origin:verified?'airbnb':'unknown'};
}
