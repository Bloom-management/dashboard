import { cleaningWindow, eventKey, hash } from './normalize';
import type { Event, Snapshot } from './types';
export type StoredEvent = Event & { sourceId: string; removed: boolean; missing: boolean };
export type JobState = { id: string; checkoutDate: string; startAt: string; endAt: string;
  status: 'open' | 'completed' | 'cancelled'; claimed: boolean; reviewRequired: boolean; eventKeys: string[] };
export type State = { events: StoredEvent[]; jobs: JobState[]; notices: Notice[] };
export type Notice = { id: string; eventKey: string; type: 'changed' | 'removed' | 'conflict'; beforeDate: string | null; afterDate: string | null };
export type Plan = { state: State; effects: { action: string; jobId: string; before: JobState | null; after: JobState | null }[] };
export const sourceEventKey = (e: StoredEvent) => JSON.stringify([e.sourceId, eventKey(e)]);
/** Pure reference planner for the database owner's transactional RPC. The RPC must lock the
 * property, source and affected jobs and persist history atomically. Never execute these effects via REST. */
export function planReconciliation(before: State, sourceId: string, snapshot: Snapshot, zone: string): Plan {
  const state: State = structuredClone(before); const effects: Plan['effects'] = [];
  if (!snapshot.complete) return { state, effects };
  const old = new Map(state.events.map(e => [sourceEventKey(e), e]));
  const changed = new Set<string>(); const seen = new Set<string>();
  const emitted = new Set<string>();
  // Match private.calendar_job_eligible: classification alone does not prove a stay.
  const eligible = (e: StoredEvent) => e.kind === 'reservation' && e.evidence === 'airbnb-reservation-link' && !e.reviewRequired;
  const notice = (key: string, type: Notice['type'], prior: StoredEvent | undefined, next: StoredEvent) => {
    const body = { eventKey: key, type, beforeDate: prior?.endDate ?? null, afterDate: next.removed ? null : next.endDate };
    const transition = hash([body, prior?.contentHash, next.contentHash, next.missing]);
    // Deduplicate within this transition, but preserve a later A→B→A→B change as new history.
    if (!emitted.has(transition)) {
      emitted.add(transition);
      state.notices.push({ id: hash([transition, before.notices.length]), ...body });
    }
  };
  for (const item of snapshot.events) {
    const next: StoredEvent = { ...item, sourceId, removed: item.status === 'cancelled', missing: false };
    const key = sourceEventKey(next); seen.add(key); const prior = old.get(key);
    if (!prior || prior.contentHash !== next.contentHash || prior.missing || prior.removed !== next.removed) {
      changed.add(key);
      if (prior) notice(key, next.removed ? 'removed' : 'changed', prior, next);
      else if (!eligible(next) || next.removed) notice(key, next.removed ? 'removed' : 'conflict', undefined, next);
      old.set(key, next);
    }
  }
  for (const [key, prior] of old) {
    if (prior.sourceId !== sourceId || seen.has(key) || prior.removed) continue;
    // Snapshot completeness is NOT evidence of export horizon coverage. Tombstone, but retain cleaning on review hold.
    const next = { ...prior, removed: true, missing: true };
    old.set(key, next); changed.add(key); notice(key, 'removed', prior, next);
  }
  state.events = [...old.values()];
  const uncertain = (e: StoredEvent) => e.missing || (!e.removed && !eligible(e));
  const occupancy = state.events.filter(e => !e.removed);
  const active = occupancy.filter(eligible);
  const affectedProtected = new Set<string>();
  for (const job of state.jobs) {
    const affected = job.eventKeys.filter(k => changed.has(k));
    if (!affected.length) continue;
    const prior = structuredClone(job);
    if (job.status === 'completed') {
      affected.forEach(k => affectedProtected.add(k));
      effects.push({ action: 'append_completed_warning', jobId: job.id, before: prior, after: null });
    } else if (job.claimed || job.reviewRequired || affected.some(k => { const e = old.get(k); return e && uncertain(e); })) {
      job.reviewRequired = true;
      affected.forEach(k => affectedProtected.add(k));
      effects.push({ action: 'hold_for_admin', jobId: job.id, before: prior, after: structuredClone(job) });
    } else {
      job.eventKeys = job.eventKeys.filter(k => { const e = old.get(k); return e && !e.removed && eligible(e) && e.endDate === job.checkoutDate; });
      if (!job.eventKeys.length) job.status = 'cancelled';
      if (JSON.stringify(prior) !== JSON.stringify(job)) effects.push({ action: 'reconcile_unclaimed', jobId: job.id, before: prior, after: structuredClone(job) });
    }
  }
  for (const event of active) {
    const key = sourceEventKey(event);
    // A pending/immutable prior turnover must be resolved explicitly, not duplicated at the new date.
    if (affectedProtected.has(key) || state.jobs.some(j => j.eventKeys.includes(key) && (j.reviewRequired || j.status === 'completed') && j.checkoutDate !== event.endDate)) continue;
    let job = state.jobs.find(j => j.checkoutDate === event.endDate);
    if (job?.eventKeys.includes(key)) continue;
    if (job?.status === 'completed' || job?.claimed || job?.reviewRequired) {
      // Preserve the completed row and assignments. New provenance goes in the append-only audit.
      if (changed.has(key)) {
        notice(key, 'conflict', undefined, event);
        effects.push({ action: job.status === 'completed' ? 'append_completed_warning' : 'hold_for_admin', jobId: job.id, before: structuredClone(job), after: null });
        if (job.status !== 'completed') job.reviewRequired = true;
      }
      continue;
    }
    const prior = job ? structuredClone(job) : null;
    if (!job) {
      job = { id: `new:${event.endDate}`, checkoutDate: event.endDate, ...cleaningWindow(event.endDate, zone), status: 'open', claimed: false, reviewRequired: false, eventKeys: [] };
      state.jobs.push(job);
    }
    job.status = 'open'; job.eventKeys.push(key);
    // Date aggregation is a turnover constraint only, never a claim that bookings match.
    // Separate identities with identical periods may share a turnover; the overlap pass
    // below holds only genuinely different overlapping periods, matching SQL.
    effects.push({ action: prior ? 'link_event' : 'create_turnover', jobId: job.id, before: prior, after: structuredClone(job) });
  }
  for (let i = 0; i < occupancy.length; i++) for (let j = i + 1; j < occupancy.length; j++) {
    const a = occupancy[i], b = occupancy[j];
    const distinctPeriod = a.startDate !== b.startDate || a.endDate !== b.endDate;
    if (distinctPeriod && ((a.startDate < b.endDate && b.startDate < a.endDate) || a.endDate === b.endDate) && (changed.has(sourceEventKey(a)) || changed.has(sourceEventKey(b)))) {
      notice(sourceEventKey(a), 'conflict', undefined, a); notice(sourceEventKey(b), 'conflict', undefined, b);
      for (const job of state.jobs.filter(j => j.checkoutDate === a.endDate || j.checkoutDate === b.endDate)) {
        if (job.status === 'completed') {
          effects.push({ action: 'append_completed_warning', jobId: job.id, before: structuredClone(job), after: null });
        } else if (job.status === 'open' && !job.reviewRequired) {
          const prior = structuredClone(job); job.reviewRequired = true;
          effects.push({ action: 'hold_for_admin', jobId: job.id, before: prior, after: structuredClone(job) });
        }
      }
    }
  }
  return { state, effects };
}
