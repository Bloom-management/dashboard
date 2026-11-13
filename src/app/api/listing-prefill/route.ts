import {currentUser} from '../../../server/auth/session';
import {response,mutation} from '../../../server/db/http';
import {BackendError} from '../../../server/db/errors';
import {listingUrl} from '../../../server/properties/airbnb-cover';
import {parseListing,type ListingImport} from '../../../server/properties/listing-import';
import {fetchPublicHtml} from '../../../server/supplies/product-preview';
export const runtime='nodejs';
/** Reads a public Airbnb listing to suggest a title, cover, rooms, supplies and maintenance. Nothing is saved. */
export async function POST(request:Request){return response(async()=>{
 const user=await currentUser();if(!['owner','admin'].includes(user.role))throw new BackendError('FORBIDDEN');
 const {body}=await mutation(request,['listingUrl']);const url=listingUrl(body.listingUrl);if(!url)throw new BackendError('VALIDATION_ERROR');
 let html:string;try{html=await fetchPublicHtml(url,4194304);}catch{return {listingUrl:url,image:null,status:'unavailable',title:null,kind:null,bedrooms:null,bathrooms:null,amenities:[],supplies:[],maintenance:[],instructions:[]} satisfies ListingImport;}
 return parseListing(html,url);
});}
