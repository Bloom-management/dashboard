import type { CalendarReviewEntry } from '../../contracts';
import { formatDate } from './dates';
import { Empty } from './primitives';

/** Render only the admin review allowlist; no mutation or feed-identity UI. */
export function CalendarReviewList({ entries }: { entries: CalendarReviewEntry[] }) {
  if (!entries.length) return <Empty title="No flagged calendar entries">No blocked, unconfirmed, or source-flagged entries are listed for this property. Check Jobs for changes affecting existing cleanings.</Empty>;
  return <>{entries.map(entry => <article className="bloom-admin-card" key={entry.id}>
    <h3>{entry.kind === 'blocked' ? 'Blocked period' : entry.kind === 'unknown' ? 'Unconfirmed period' : 'Reservation'}</h3>
    <p>{entry.provider === 'airbnb' ? 'Airbnb' : 'Vrbo'} · {formatDate(entry.startDate)}–{formatDate(entry.endDate)} · End date exclusive</p>
    <p>{entry.status === 'removed' ? 'Removed from source' : 'Active in source'} · {entry.reviewRequired ? 'Needs review' : 'No review flag'}</p>
    {entry.missingReason === 'horizon_unknown' && <p className="bloom-notice">Missing from the latest export. The calendar's date range is uncertain, so this is not a confirmed cancellation.</p>}
    {entry.kind !== 'reservation' && <p>This unconfirmed stay does not create a new cleaning job. Any existing job may still need admin review.</p>}
  </article>)}</>;
}
