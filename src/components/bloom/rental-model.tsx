'use client';
import { useCallback, useMemo, useRef, useState } from 'react';
import { request } from './api';
import { ErrorNotice, Icon, Loading, useResource } from './primitives';
import { ButtonContent } from './button-content';
import { AnimatedContent } from './animated-content';
import { Select } from '../ui/select';
import draftStyles from './room-listings/drafts.module.css';
import styles from './rental-model.module.css';
import type { OwnerListing } from '../../contracts/owner-hub';

type Pricing = { firstHostCents: number | null; additionalHostCents: number | null; firstPoolCents: number | null; additionalPoolCents: number | null };
type Room = { id: string; name: string; identifier: string | null; status: string; nightlyRateCents: number | null; hasEntry: boolean; hasChannel: boolean; channelCheckRequired: boolean };
export type RentalModel = {
  listing: { id: string; name: string; listingType: 'room' | 'entire_home'; status: string; houseId: string | null; channelCheckRequired: boolean; archivedAt: string | null; canConvert: boolean };
  house: { id: string; name: string; address: string; timezone: string; pricing: (Pricing & { revision: number }) | null; sharedSpaces: { id: string; kind: string; label: string }[] } | null;
  rooms: Room[] | null;
  pendingMerge: { id: string; survivorId: string; scheduledFor: string; createdAt: string; lastError: string | null } | null;
  splitDefaults: { reusesHouse: boolean; pricing: Pricing; sharedSpaces: { kind: string; label: string }[]; blockedByClaimedCleaning: boolean } | null;
  mergePreview: { survivorId: string; lastCheckout: string | null }[] | null;
};

const SHARED = [['kitchen', 'Kitchen'], ['living_room', 'Living room'], ['bathroom', 'Bathroom'], ['house_laundry', 'Laundry'], ['outdoor', 'Backyard']] as const;
const ENTRY = [['keypad', 'Keypad'], ['lockbox', 'Lockbox'], ['key', 'Key'], ['other', 'Other']] as const;
const dollars = (cents: number | null | undefined) => cents == null ? '' : String(cents / 100);
const cents = (value: string) => { const n = Number(value); return value.trim() === '' || !Number.isFinite(n) ? null : Math.round(n * 100); };
const day = (iso: string, timeZone?: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone });
const localDay = (date: string) => new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
/** The pending merge runs at the end of the last checkout day, so show that checkout day. */
const mergeDay = (iso: string, timeZone?: string) => day(new Date(new Date(iso).getTime() - 60_000).toISOString(), timeZone);
const STATUS: Record<string, string> = { active: 'Active', needs_channel_link: 'Needs channel link', draft: 'Draft', archived: 'Archived', inactive: 'Inactive' };

/** Settings › Rental model. Opens the split or merge studio in place of the card. */
export function RentalModelSettings({ listing, onChanged }: { listing: OwnerListing; onChanged: () => void }) {
  const load = useCallback((signal: AbortSignal) => request<RentalModel>(`/properties/${encodeURIComponent(listing.id)}/rental-model`, { signal }), [listing.id]);
  const data = useResource(load);
  const [studio, setStudio] = useState<'split' | 'merge' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const done = () => { setStudio(null); data.reload(); onChanged(); };
  async function act(action: 'cancel_merge' | 'confirm_channel') {
    if (busy) return; setBusy(true); setError(undefined);
    try { await request(`/properties/${encodeURIComponent(listing.id)}/rental-model`, { body: { action, data: {} } }); data.reload(); onChanged(); } catch (e) { setError(e); } finally { setBusy(false); }
  }
  if (data.loading) return <Loading />;
  if (data.error || !data.data) return <ErrorNotice error={data.error} retry={data.reload} />;
  const model = data.data; const room = model.listing.listingType === 'room'; const archived = model.listing.status === 'archived';
  if (studio === 'split') return <SplitStudio model={model} onCancel={() => setStudio(null)} onDone={done} />;
  if (studio === 'merge') return <MergeStudio model={model} onCancel={() => setStudio(null)} onDone={done} />;
  return <AnimatedContent><div className={styles.stack}>
    {model.pendingMerge && <div className={styles.banner} role="status"><div><strong>Merge scheduled · {mergeDay(model.pendingMerge.scheduledFor, model.house?.timezone)}</strong></div>{model.listing.canConvert && <button type="button" className="bloom-button secondary" disabled={busy} onClick={() => void act('cancel_merge')}>Cancel merge</button>}</div>}
    {model.listing.channelCheckRequired && !archived && <div className={styles.banner} role="status"><div><strong>Confirm this channel link still works</strong></div><button type="button" className="bloom-button secondary" disabled={busy} onClick={() => void act('confirm_channel')}>Link works</button></div>}
    <section className={styles.card} aria-labelledby={`rental-model-${listing.id}`}>
      <div className={styles.cardHead}><h3 id={`rental-model-${listing.id}`}>Rental model</h3>
        {model.listing.canConvert && !model.pendingMerge && (room
          ? <button type="button" className="bloom-button" onClick={() => setStudio('merge')}>Merge into one unit…</button>
          : <button type="button" className="bloom-button" disabled={!!model.splitDefaults?.blockedByClaimedCleaning} onClick={() => setStudio('split')}>Split into rooms…</button>)}
        {archived && <span className={styles.chip}>Archived</span>}
      </div>
      <div className={styles.models} role="radiogroup" aria-label="Rental model" aria-readonly="true">
        <div role="radio" aria-checked={!room} className={`${styles.model}${!room ? ` ${styles.selected}` : ''}`}><strong>Entire unit</strong><span>One listing for the whole place</span></div>
        <div role="radio" aria-checked={room} className={`${styles.model}${room ? ` ${styles.selected}` : ''}`}><strong>Room model</strong><span>One listing per bedroom, shared spaces</span></div>
      </div>
      {model.splitDefaults?.blockedByClaimedCleaning && <p className="bloom-notice" role="status">A claimed future cleaning must be resolved by an admin before splitting.</p>}
      {room && model.rooms && <ul className={styles.roomList} aria-label={`Rooms in ${model.house?.name ?? 'this house'}`}>{model.rooms.map(r => <li key={r.id}><span className={`${styles.dot} ${styles[r.status] ?? ''}`} aria-hidden="true" /><strong>{r.name}</strong><span className={styles.muted}>{STATUS[r.status] ?? r.status}</span>{r.nightlyRateCents != null && <span>${dollars(r.nightlyRateCents)}</span>}</li>)}</ul>}
    </section>
    {error != null && <ErrorNotice error={error} />}
  </div></AnimatedContent>;
}

function Steps({ names, step, onStep }: { names: string[]; step: number; onStep: (i: number) => void }) {
  return <ol className={styles.steps} aria-label="Steps">{names.map((name, i) => <li key={name}><button type="button" aria-current={i === step ? 'step' : undefined} disabled={i > step} onClick={() => onStep(i)} className={i === step ? styles.stepActive : i < step ? styles.stepDone : ''}><span className={styles.stepNumber} aria-hidden="true">{i < step ? <span className={styles.checkMark} /> : i + 1}</span>{name}</button></li>)}</ol>;
}
function StudioFrame({ title, names, step, setStep, onCancel, canContinue, last, finishLabel, onFinish, busy, error, preview, children }: { title: string; names: string[]; step: number; setStep: (n: number) => void; onCancel: () => void; canContinue: boolean; last: boolean; finishLabel: string; onFinish: () => void; busy: boolean; error: unknown; preview: React.ReactNode; children: React.ReactNode }) {
  return <section className={styles.studio} aria-label={title}>
    <div className={styles.studioHead}><h3>{title}</h3><button type="button" className="bloom-button secondary" onClick={onCancel}><ButtonContent icon={<Icon name="close" />}>Cancel</ButtonContent></button></div>
    <Steps names={names} step={step} onStep={setStep} />
    <div className={styles.studioBody}>
      <div className={styles.panel}><AnimatedContent><div className={styles.panelInner}>{children}</div></AnimatedContent>
        {error != null && <ErrorNotice error={error} />}
        <div className={styles.footer}><button type="button" className="bloom-button secondary" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>Back</button>
          {last ? <button type="button" className="bloom-button" disabled={!canContinue || busy} onClick={onFinish}>{busy ? 'Working…' : finishLabel}</button>
            : <button type="button" className="bloom-button" disabled={!canContinue} onClick={() => setStep(step + 1)}>Continue</button>}</div>
      </div>
      <aside className={styles.preview} aria-label="Live preview">{preview}</aside>
    </div>
  </section>;
}

type DraftRoom = { name: string; rate: string; access: 'copy' | 'own' | 'later'; entryType: string; code: string };
export function SplitStudio({ model, onCancel, onDone }: { model: RentalModel; onCancel: () => void; onDone: () => void }) {
  const defaults = model.splitDefaults!;
  const [step, setStep] = useState(0);
  const [rooms, setRooms] = useState<DraftRoom[]>([{ name: 'Room 1', rate: '', access: 'copy', entryType: 'keypad', code: '' }, { name: 'Room 2', rate: '', access: 'later', entryType: 'keypad', code: '' }]);
  const [keep, setKeep] = useState(0);
  const [shared, setShared] = useState<Set<string>>(() => new Set(defaults.sharedSpaces.length ? defaults.sharedSpaces.map(s => s.kind) : ['kitchen', 'living_room', 'house_laundry']));
  const [pricing, setPricing] = useState({ firstHost: dollars(defaults.pricing.firstHostCents), extraHost: dollars(defaults.pricing.additionalHostCents), firstPool: dollars(defaults.pricing.firstPoolCents), extraPool: dollars(defaults.pricing.additionalPoolCents) });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>();
  const key = useRef(crypto.randomUUID());
  const update = (i: number, patch: Partial<DraftRoom>) => setRooms(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r));
  const setCount = (n: number) => { setRooms(rs => n > rs.length ? [...rs, ...Array.from({ length: n - rs.length }, (_, k) => ({ name: `Room ${rs.length + k + 1}`, rate: '', access: 'later' as const, entryType: 'keypad', code: '' }))] : rs.slice(0, n)); if (keep >= n) setKeep(0); };
  const names = rooms.map(r => r.name.trim());
  const roomsValid = names.every(n => n.length > 0 && n.length <= 100) && new Set(names.map(n => n.toLowerCase())).size === names.length && shared.size > 0 && rooms.every(r => r.rate.trim() === '' || cents(r.rate) != null);
  const accessValid = rooms.every(r => r.access !== 'own' || r.code.trim().length > 0);
  const p = { firstHostCents: cents(pricing.firstHost), additionalHostCents: cents(pricing.extraHost), firstPoolCents: cents(pricing.firstPool), additionalPoolCents: cents(pricing.extraPool) };
  const pricingSet = p.firstHostCents != null && p.firstHostCents > 0 && p.additionalHostCents != null && p.firstPoolCents != null && p.firstPoolCents > 0 && p.firstPoolCents % 2 === 0 && p.additionalPoolCents != null && p.additionalPoolCents % 2 === 0;
  const live = (i: number) => i === keep ? model.listing.status !== 'draft' : rooms[i].access === 'copy' || rooms[i].access === 'own';
  const liveCount = rooms.filter((_, i) => live(i)).length;
  async function split() {
    if (busy) return; setBusy(true); setError(undefined);
    const body = { action: 'split', data: { keep, shared: SHARED.filter(([k]) => shared.has(k)).map(([kind, label]) => ({ kind, label })), pricing: p,
      rooms: rooms.map(r => ({ name: r.name.trim(), identifier: r.name.trim(), ...(cents(r.rate) != null ? { nightlyRateCents: cents(r.rate) } : {}),
        ...(r.access === 'copy' ? { access: 'copy' } : r.access === 'own' ? { access: { entryType: r.entryType, code: r.code.trim(), entryNotes: '', parking: [], garageCode: '', parkingNotes: '' } } : {}) })) } };
    try { await request(`/properties/${encodeURIComponent(model.listing.id)}/rental-model`, { body, key: key.current }); onDone(); }
    catch (e) { setError(e); key.current = crypto.randomUUID(); } finally { setBusy(false); }
  }
  const preview = <><span className={styles.eyebrow}>Live preview</span><strong className={styles.previewTitle}>{model.listing.name}</strong><span className={styles.chipRose}>Room model · {rooms.length} rooms</span>
    <div className={styles.previewShared}><strong>Shared:</strong> {SHARED.filter(([k]) => shared.has(k)).map(([, l]) => l).join(', ') || 'None'}</div>
    {rooms.map((r, i) => <div key={i} className={styles.previewRoom}><div><strong>{r.name || `Room ${i + 1}`}</strong>{r.rate && <span>${r.rate}</span>}</div><div className={styles.flags}><span className={i === keep ? styles.flagOn : ''}><span className={styles.flagMark} aria-hidden="true" />Channel</span><span className={r.access !== 'later' || i === keep ? styles.flagOn : ''}><span className={styles.flagMark} aria-hidden="true" />Access</span></div></div>)}</>;
  const stepsBody = [
    <><h4>Define the rooms</h4>
      <div className={styles.counter}><span id="split-room-count">Number of rooms</span><div role="group" aria-labelledby="split-room-count"><button type="button" aria-label="Fewer rooms" disabled={rooms.length <= 2} onClick={() => setCount(rooms.length - 1)}><Icon name="minus" /></button><output aria-live="polite">{rooms.length}</output><button type="button" aria-label="More rooms" disabled={rooms.length >= 6} onClick={() => setCount(rooms.length + 1)}><Icon name="plus" /></button></div></div>
      {rooms.map((r, i) => <div key={i} className={styles.roomRow}><label>Room name<input value={r.name} maxLength={100} onChange={e => update(i, { name: e.target.value })} /></label><label>Rate · USD<input inputMode="decimal" value={r.rate} onChange={e => update(i, { rate: e.target.value })} /></label></div>)}
      <h4>Shared spaces</h4>
      <div className={styles.chips} role="group" aria-label="Shared spaces">{SHARED.map(([k, l]) => <button key={k} type="button" aria-pressed={shared.has(k)} onClick={() => setShared(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })}>{l}</button>)}</div></>,
    <><h4>Calendars & channels</h4>
      <label>Existing calendar and reservations stay with<Select value={keep} onChange={e => setKeep(Number(e.target.value))}>{rooms.map((r, i) => <option key={i} value={i}>{r.name || `Room ${i + 1}`}</option>)}</Select></label>
      {rooms.map((r, i) => <div key={i} className={styles.channelRow}><strong>{r.name || `Room ${i + 1}`}</strong><span className={i === keep ? styles.badgeGreen : styles.badgeAmber}>{i === keep ? 'Keeps calendar' : 'Needs channel link'}</span></div>)}</>,
    <><h4>Access</h4>
      {rooms.map((r, i) => <fieldset key={i} className={styles.accessRow}><legend>{r.name || `Room ${i + 1}`}</legend>
        <div className={styles.chips} role="radiogroup" aria-label={`${r.name} access`}>{([['copy', 'Same as unit'], ['own', 'Own code'], ['later', 'Set later']] as const).map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={r.access === v} onClick={() => update(i, { access: v })}>{l}</button>)}</div>
        {r.access === 'own' && <div className={styles.roomRow}><label>Entry type<Select value={r.entryType} onChange={e => update(i, { entryType: e.target.value })}>{ENTRY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></label><label>Code<input value={r.code} maxLength={100} onChange={e => update(i, { code: e.target.value })} /></label></div>}
      </fieldset>)}</>,
    <><h4>Review</h4>
      <ul className={styles.checklist}><li className={liveCount === rooms.length ? styles.ok : styles.warn}>{liveCount} of {rooms.length} rooms can go live now</li><li className={pricingSet ? styles.ok : styles.warn}>{pricingSet ? 'Cleaning prices set' : 'Cleaning prices not set'}</li></ul>
      <h4>Cleaning prices</h4>
      <div className={styles.priceGrid}>
        <label>First room · host<input inputMode="decimal" value={pricing.firstHost} onChange={e => setPricing({ ...pricing, firstHost: e.target.value })} /></label>
        <label>Each extra room · host<input inputMode="decimal" value={pricing.extraHost} onChange={e => setPricing({ ...pricing, extraHost: e.target.value })} /></label>
        <label>First room · cleaner<input inputMode="decimal" value={pricing.firstPool} onChange={e => setPricing({ ...pricing, firstPool: e.target.value })} /></label>
        <label>Each extra room · cleaner<input inputMode="decimal" value={pricing.extraPool} onChange={e => setPricing({ ...pricing, extraPool: e.target.value })} /></label>
      </div>
      <ul className={styles.summary}>{rooms.map((r, i) => <li key={i}><strong>{r.name}</strong><span>{i === keep ? 'Keeps calendar · Confirm link' : live(i) ? 'Needs channel link' : 'Draft'}</span></li>)}</ul></>,
  ];
  const can = [roomsValid, true, accessValid, roomsValid && accessValid && pricingSet][step];
  return <StudioFrame title={`Split ${model.listing.name} into rooms`} names={['Rooms', 'Channels', 'Access', 'Review']} step={step} setStep={setStep} onCancel={onCancel} canContinue={can} last={step === 3} finishLabel="Split into rooms" onFinish={() => void split()} busy={busy} error={error} preview={preview}>{stepsBody[step]}</StudioFrame>;
}

export function MergeStudio({ model, onCancel, onDone }: { model: RentalModel; onCancel: () => void; onDone: () => void }) {
  const rooms = useMemo(() => model.rooms ?? [], [model.rooms]);
  const [step, setStep] = useState(0);
  const [survivor, setSurvivor] = useState(model.listing.id);
  const [later, setLater] = useState(false);
  const [name, setName] = useState(model.house?.name ?? model.listing.name);
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>();
  const key = useRef(crypto.randomUUID());
  const keeper = rooms.find(r => r.id === survivor);
  const lastCheckout = model.mergePreview?.find(m => m.survivorId === survivor)?.lastCheckout ?? null;
  async function merge() {
    if (busy) return; setBusy(true); setError(undefined);
    try { await request(`/properties/${encodeURIComponent(model.listing.id)}/rental-model`, { body: { action: 'merge', data: { survivorId: survivor, name: name.trim(), when: lastCheckout ? 'after_last_checkout' : 'now', ...(cents(rate) != null ? { nightlyRateCents: cents(rate) } : {}) } }, key: key.current }); onDone(); }
    catch (e) { setError(e); key.current = crypto.randomUUID(); } finally { setBusy(false); }
  }
  const preview = <><span className={styles.eyebrow}>Live preview</span><strong className={styles.previewTitle}>{name || model.house?.name}</strong><span className={styles.chip}>Entire unit</span>
    {rooms.map(r => <div key={r.id} className={styles.previewRoom}><div><strong>{r.name}</strong><span>{r.id === survivor ? 'Main listing' : 'Archived'}</span></div></div>)}</>;
  const body = [
    <><h4>Choose the main listing</h4>
      <div className={styles.choiceList} role="radiogroup" aria-label="Main listing">{rooms.map(r => <button key={r.id} type="button" role="radio" aria-checked={survivor === r.id} onClick={() => setSurvivor(r.id)}><span className={styles.radio} aria-hidden="true" /><strong>{r.name}</strong><span className={styles.muted}>{r.hasChannel ? 'Has channel link' : 'No channel link'}</span></button>)}</div></>,
    <><h4>Reservations</h4>
      {lastCheckout ? <><p role="status" className={styles.notice}>Other rooms have stays through {localDay(lastCheckout)}.</p>
        <label className={styles.check}><input type="checkbox" checked={later} onChange={e => setLater(e.target.checked)} />Merge after the last checkout instead</label></>
        : <p role="status" className={styles.notice}>No upcoming stays on the other rooms.</p>}</>,
    <><h4>Unit details</h4>
      <label>Listing name<input value={name} maxLength={200} onChange={e => setName(e.target.value)} /></label>
      <label>Nightly rate · USD<input inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} /></label></>,
    <><h4>Review</h4>
      <ul className={styles.summary}><li><strong>{keeper?.name}</strong><span>Becomes {name.trim() || 'the unit'} · keeps its calendar, access and parking</span></li>{rooms.filter(r => r.id !== survivor).map(r => <li key={r.id}><strong>{r.name}</strong><span>Archived · syncs stopped · history kept</span></li>)}</ul>
      {lastCheckout && <p role="status" className={styles.warning}>Rooms stay bookable until the merge runs after {localDay(lastCheckout)}.</p>}
      <p role="alert" className={styles.warning}>Airbnb may issue a new link for the merged listing. Confirm or update it after merging.</p></>,
  ];
  const can = [!!keeper, !lastCheckout || later, name.trim().length > 0 && (rate.trim() === '' || cents(rate) != null), true][step];
  return <StudioFrame title={`Merge ${model.house?.name ?? 'rooms'} into one unit`} names={['Choose listing', 'Reservations', 'Details', 'Review']} step={step} setStep={setStep} onCancel={onCancel} canContinue={can} last={step === 3} finishLabel={lastCheckout ? 'Schedule merge' : 'Merge into one unit'} onFinish={() => void merge()} busy={busy} error={error} preview={preview}>{body[step]}</StudioFrame>;
}

/** View-only history cards for listings archived by a merge. */
export function ArchivedListings({ listings }: { listings: OwnerListing[] }) {
  if (!listings.length) return null;
  return <section aria-label="Archived listings"><h3>Archived</h3><div className={draftStyles.cards}>{listings.map(l => <article key={l.id} className={`${draftStyles.card} ${styles.archivedCard}`} aria-label={`${l.name}, archived`}>
    <span className={draftStyles.cover}><Icon name="house" size={36} /><span className={draftStyles.status}><span className={`${draftStyles.dot} ${styles.archivedDot}`} aria-hidden="true" />Archived</span></span>
    <strong className={draftStyles.title}>{l.name}</strong>{l.houseName && <span className={draftStyles.meta}>Room in {l.houseName}</span>}{l.archivedAt && <span className={draftStyles.meta}>Archived {day(l.archivedAt)}</span>}
  </article>)}</div></section>;
}

/** Rail chip: Entire unit, N rooms · shared spaces, or Merge scheduled. */
export function modelChip(listing: OwnerListing, roomCount: number) {
  if (listing.pendingMerge) return <span className={styles.chipRose}>Merge scheduled · {mergeDay(listing.pendingMerge.scheduledFor, listing.timezone)}</span>;
  return listing.houseId ? <span className={styles.chipRose}>{roomCount} rooms · shared spaces</span> : <span className={styles.chip}>Entire unit</span>;
}
export const railStyles = styles;
