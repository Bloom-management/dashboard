import { claimPendingOwner } from '../../../../server/auth/claim-pending-owner';
import { mutation, response } from '../../../../server/db/http';
import { BackendError } from '../../../../server/db/errors';
export async function POST(request: Request) {
  return response(async () => {
    await mutation(request, []);
    const user = await claimPendingOwner();
    if (!user) throw new BackendError('NOT_FOUND');
    return user;
  });
}
