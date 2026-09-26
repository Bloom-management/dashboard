export type CleaningManagement = 'bloom' | 'private';
export type TeamInvitation = {id:string;email:string;status:'pending'|'sent'|'accepted'|'revoked'|'expired';expiresAt:string};
export type IncomingTeamInvitation = {id:string;propertyId:string;propertyName:string;status:'pending'|'accepted'|'revoked'|'expired';expiresAt:string};
export type CleaningTeamMember = {id:string;name:string;defaultAssigned:boolean;individualAmountCents:number|null;needsResolution:boolean};
export type CleaningTeam = {
 propertyId:string;management:CleaningManagement;bloomApproved:boolean;
 requestStatus:'none'|'pending'|'accepted'|'unavailable';capacity:number;totalCents:number;
 payerOwnerId:string|null;members:CleaningTeamMember[];invitations:TeamInvitation[];
};
export type CleanerNetwork = {enabled:boolean;cityId:string|null};
