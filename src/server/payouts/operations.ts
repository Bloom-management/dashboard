import { BackendError } from '@/server/db/errors';
import 'server-only';
import { currentUser, requireAdmin } from '@/server/auth/session';
import { mutation, uuid } from '@/server/db/http';
import { userRpc } from '@/server/db/rpc';
import type { CleanerPayouts, PayoutDetail, PayoutSummary } from '@/contracts/payouts';

export async function payoutSummary() {
  await requireAdmin();
  return userRpc<PayoutSummary>('bloom_admin_payouts');
}
export async function payoutDetail(cleanerId: string) {
  await requireAdmin();
  return userRpc<PayoutDetail>('bloom_admin_payouts', { p_cleaner: uuid(cleanerId) });
}
export async function payoutMutation(request: Request, cleanerId: string, action: 'payment'|'adjustment'|'void'|'preference', paymentId?: string) {
  await requireAdmin();
  const fields = { payment:['amountCents','method','paymentDate','note','allocations'], adjustment:['cleaningId','amountCents','reason'], void:['reason'], preference:['method'] };
  const { body, key } = await mutation(request, fields[action]);
  return userRpc<{id:string}>('bloom_admin_payout_action', { p_cleaner:uuid(cleanerId), p_action:action, p_data:paymentId ? {...body,paymentId:uuid(paymentId)} : body, p_key:key });
}

export async function cleanerPayouts() {
  const user = await currentUser();
  if (user.role !== 'cleaner' && user.role !== 'admin') throw new BackendError('FORBIDDEN');
  return userRpc<CleanerPayouts>('bloom_cleaner_payouts');
}
