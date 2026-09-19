import type { OwnerCalendarBlock, Provider } from '../../contracts/index';
/** Input MUST come from an owner-authorized RLS query/RPC, with membership checked in the DB.
 * Event IDs remain distinct across providers, including same-date bookings and tombstones. */
export function ownerBlocks(rows: Array<{ id: string; propertyId: string; propertyName: string; timezone: string;
  startDate: string; endDate: string; provider: Provider; kind: 'reservation' | 'blocked' | 'unknown'; removed: boolean;
  changes: Array<{ id: string; type: 'changed' | 'removed' | 'conflict'; acknowledged: boolean }> }>): OwnerCalendarBlock[] {
  const messages = { changed: 'Calendar dates changed.', removed: 'This calendar event was removed. Review may be pending.', conflict: 'Calendar details need administrator review.' };
  return rows.map(row => ({ id: row.id, propertyId: row.propertyId, propertyName: row.propertyName, timezone: row.timezone,
    startDate: row.startDate, endDate: row.endDate, providers: [row.provider], kind: row.kind, removed: row.removed,
    changes: row.changes.map(c => ({ id: c.id, type: c.type, acknowledged: c.acknowledged, message: messages[c.type] })) }));
}
