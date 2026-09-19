import { response } from '../../../server/db/http';
import { incomingPropertyInvitations } from '../../../server/owner/people';
export async function GET(){return response(incomingPropertyInvitations);}
