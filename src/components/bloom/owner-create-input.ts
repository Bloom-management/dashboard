import type { OwnerListing, OwnerListingCreateInput } from '../../contracts/owner-hub';
export type OwnerListingDraft={name:string;address:string;cityId:string;timezone:string;bedroomCount:string;bathroomCount:string};
export function ownerCreateInput(draft:OwnerListingDraft):OwnerListingCreateInput|null {
 const name=draft.name.trim(),address=draft.address.trim(),timezone=draft.timezone.trim();
 if(!name||name.length>200||!address||address.length>500||!draft.cityId||!timezone||timezone.length>100)return null;
 if(!/^(?:[0-9]|1[0-9]|20)$/.test(draft.bedroomCount)||!/^(?:[0-9]|1[0-9]|20)$/.test(draft.bathroomCount))return null;
 try{new Intl.DateTimeFormat('en-US',{timeZone:timezone}).format();}catch{return null;}
 return {name,address,cityId:draft.cityId,timezone,bedroomCount:Number(draft.bedroomCount),bathroomCount:Number(draft.bathroomCount)};
}

/** These server rejections prove creation did not succeed; other failures need the original receipt. */
export function ownerCreationMayHaveSucceeded(code?:string):boolean {
 return !['VALIDATION_ERROR','FORBIDDEN','UNAUTHENTICATED','NOT_FOUND','CONFLICT','INVALID_STATE'].includes(code??'');
}

/** Only successful POST receipts enter this collection; fresh server projections win by ID. */
export function unconfirmedCreatedListings(server:OwnerListing[],created:OwnerListing[]):OwnerListing[] {
 return created.filter(listing=>!server.some(item=>item.id===listing.id));
}
export function mergeCreatedListings(server:OwnerListing[],created:OwnerListing[]):OwnerListing[] {
 return [...server,...unconfirmedCreatedListings(server,created)];
}
