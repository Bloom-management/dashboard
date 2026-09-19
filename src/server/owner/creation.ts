import 'server-only';
import type { OwnerListingCreateInput, OwnerListingCreateResult } from '../../contracts/owner-hub';
import { mutation, uuid, text, integer } from '../db/http';
import { userRpc } from '../db/rpc';
export async function createOwnerListing(request: Request): Promise<OwnerListingCreateResult> {
 const {body,key} = await mutation(request,['name','address','cityId','timezone','bedroomCount','bathroomCount']);
 const input: OwnerListingCreateInput = {name:text(body.name,200),address:text(body.address,500),cityId:uuid(body.cityId),timezone:text(body.timezone,100),bedroomCount:integer(body.bedroomCount,0,20),bathroomCount:integer(body.bathroomCount,0,20)};
 return userRpc<OwnerListingCreateResult>('bloom_owner_listing_create',{p_input:input,p_key:key});
}
