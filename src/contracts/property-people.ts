export type PropertyInvitation = { id:string;email:string;status:'pending'|'sent'|'accepted'|'expired';expiresAt:string };
export type PropertyPerson = { id:string;displayName:string;imageUrl:string|null;location?:string|null };
export type PropertyPeople = { propertyId:string;bloomOwned:boolean;members:PropertyPerson[];invitations:PropertyInvitation[] };
export type IncomingPropertyInvitation = { id:string;propertyId:string;propertyName:string;inviterName:string;expiresAt:string };
