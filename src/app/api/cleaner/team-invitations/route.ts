import {incomingTeamInvitations} from '@/server/teams/operations';
import {response} from '@/server/db/http';
export const runtime='nodejs';
export async function GET(){return response(async()=>incomingTeamInvitations());}
