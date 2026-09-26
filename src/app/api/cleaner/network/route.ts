import {cleanerNetwork,updateCleanerNetwork} from '@/server/teams/operations';
import {response} from '@/server/db/http';
export const runtime='nodejs';
export async function GET(){return response(async()=>cleanerNetwork());}
export async function POST(request:Request){return response(async()=>updateCleanerNetwork(request));}
