import type {CleaningManagement} from './cleaning-teams';
export type CalendarAddProperty = {
 id:string;name:string;timezone:string;defaultStartTime:string;defaultEndTime:string;
 management:CleaningManagement;bloomApproved:boolean;bloomAvailable:boolean;bloomRequestStatus:string;
 payerName:string;privatePayerName:string|null;canEditPrivateCompensation:boolean;canAssignBloom:boolean;
 capacity:number;totalCents:number;soloRateCents:number;sharedRateCents:number;
 bloomCleaners:{id:string;name:string}[];
 teamMembers:{id:string;name:string;defaultAssigned:boolean;individualAmountCents:number|null}[];
};
export type CalendarAddOptions={properties:CalendarAddProperty[]};
export type CalendarAddCleaning={
 id:string;propertyId:string;propertyName:string;timezone:string;date:string;startTime:string;endTime:string;
 management:CleaningManagement;eligibleForCheckout:boolean;status:'open'|'completed'|'cancelled';eligibleToMove:boolean;version:number;
 assignedCleaners:{id:string;name:string}[];
};
export type CalendarAddAvailability={propertyId:string;timezone:string;from:string;to:string;
 stays:{id:string;startDate:string;endDate:string;label:string}[];cleanings:CalendarAddCleaning[];
 /** A booking with an existing open checkout cleaning must explicitly reuse that ID/version. */
 checkoutResolutions:('create'|'reuse'|'additional')[];
};
export type CalendarAddCleaningInput={kind:'cleaning';propertyId:string;action:'create'|'move';date:string;
 startTime:string;endTime:string;comments:string;management:CleaningManagement;capacity:number;totalCents:number;
 cleaners:{id:string;individualAmountCents:number|null}[];
 existingCleaningId?:string;expectedVersion?:number;reviewToken?:string;additionalAcknowledged?:boolean;inStayAcknowledged:boolean;assignedImpactAcknowledged:boolean;
};
export type CalendarAddBookingInput={kind:'booking';propertyId:string;checkIn:string;checkout:string;note:string;
 reviewToken?:string;assignedImpactAcknowledged?:boolean;
 checkoutResolution:{action:'create'}|{action:'reuse';cleaningId:string;expectedVersion:number}|{action:'additional'};
};
export type CalendarAddInput=CalendarAddCleaningInput|CalendarAddBookingInput;
export type CalendarAddResult={status:'created'|'moved'|'requested';cleaningId:string;bookingId?:string;date:string};
/** Business conflicts are returned as data so the draft can stay intact and show a useful explanation. */
export type CalendarAddConflict={status:'conflict';code:'occupied'|'existing_cleaning'|'cleaning_changed'|'in_stay'|'assigned_impact'|'staffing'|'management';message:string};
export type CalendarAddResponse=CalendarAddResult|CalendarAddConflict;
