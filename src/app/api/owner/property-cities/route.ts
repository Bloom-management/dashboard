import {response} from '@/server/db/http';
import {userRpc} from '@/server/db/rpc';
export async function GET(){return response(()=>userRpc('bloom_owner_property_cities'));}
