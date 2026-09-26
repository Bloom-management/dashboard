export const paymentMethods = ['Zelle','Cash App','Venmo','PayPal','Cash','Bank transfer','Other'] as const;
export type PaymentMethod = typeof paymentMethods[number];
export type PayoutPerson = { id:string; name:string; preferredMethod:PaymentMethod|null; totalDueCents:number; reviewCount:number };
export type PayoutSummary = { people:PayoutPerson[]; totalOutstandingCents:number; reviewCount:number; unassignedReviewCount:number };
export type PayoutAdjustment = { id:string; amountCents:number; reason:string; enteredBy:string; createdAt:string };
export type PayoutCleaning = { id:string; jobId:string; propertyName:string; cleaningDate:string; participation:'solo'|'shared'; originalEarningsCents:number|null; adjustmentCents:number; paidCents:number; remainingCents:number|null; status:'unpaid'|'partial'|'paid'|'review'; reviewReason:string|null; comments:string|null; adjustments:PayoutAdjustment[] };
export type PayoutPayment = { id:string; amountCents:number; method:PaymentMethod; paymentDate:string; note:string|null; enteredBy:string; createdAt:string; allocations:{cleaningId:string; amountCents:number; propertyName:string; cleaningDate:string}[]; voidedAt:string|null; voidedBy:string|null; voidReason:string|null };
export type PayoutDetail = PayoutPerson & { cleanings:PayoutCleaning[]; payments:PayoutPayment[] };
export type RecordPaymentInput = { amountCents:number; method:PaymentMethod; paymentDate:string; note?:string; allocations:{cleaningId:string;amountCents:number}[] };

export type CleanerPayouts = PayoutDetail & { nextPayoutAt:string; payoutTimezone:string };
