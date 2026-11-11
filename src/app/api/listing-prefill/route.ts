import {currentUser} from '../../../server/auth/session';
import {response,mutation} from '../../../server/db/http';
import {BackendError} from '../../../server/db/errors';
import {listingUrl,extractCover} from '../../../server/properties/airbnb-cover';
export const runtime='nodejs';
export async function POST(request:Request){return response(async()=>{
 const user=await currentUser();if(!['owner','admin'].includes(user.role))throw new BackendError('FORBIDDEN');
 const {body}=await mutation(request,['listingUrl']);const url=listingUrl(body.listingUrl);if(!url)throw new BackendError('VALIDATION_ERROR');
 const image=await extractCover(url);return {listingUrl:url,image,status:image?'extracted':'unavailable'};
});}
