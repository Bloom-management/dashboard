import {authenticatedDatabase,currentUser} from '@/server/auth/session';
import {response,mutation} from '@/server/db/http';
import {privilegedDatabase} from '@/server/db/privileged';
import {databaseError,BackendError} from '@/server/db/errors';
import {decodePlace} from '@/server/locations/cities';
import {cachedCitySearch} from '@/server/locations/city-cache';
export async function GET(request:Request){return response(async()=>{await authenticatedDatabase();const q=new URL(request.url).searchParams.get('q')?.trim()??'';if(q.length<2||q.length>150)throw new BackendError('VALIDATION_ERROR');return cachedCitySearch(q);});}
export async function POST(request:Request){return response(async()=>{const user=await currentUser();const {body}=await mutation(request,['place']);const place=decodePlace(body.place);const timezone=place.timezone;const {data,error}=await privilegedDatabase().rpc('bloom_city_register',{p_actor:user.id,p_place:place,p_timezone:timezone});if(error)databaseError(error);return data;});}
