import { ownerListings } from '../../../../server/owner/operations';
import { response } from '../../../../server/db/http';
export async function GET(request: Request) { return response(() => ownerListings(request)); }
import { createOwnerListing } from '../../../../server/owner/creation';
export async function POST(request: Request) { return response(() => createOwnerListing(request)); }
