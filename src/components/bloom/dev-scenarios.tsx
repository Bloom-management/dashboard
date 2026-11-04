'use client';

import { useState } from 'react';
import { request, ApiError } from './api';
import { ErrorNotice, Loading, useResource } from './primitives';
import { Select } from '../ui/select';

type Catalog = { properties: { id: string; name: string; cityId: string }[]; cleaners: { id: string; name: string; cityId: string | null }[] };
type Step = 'assigned'|'progress'|'photos'|'supplies'|'maintenance'|'guest';
const steps: { id: Step; label: string; description: string }[] = [
  { id: 'assigned', label: 'Ready to start', description: 'Assigned but not started' },
  { id: 'progress', label: 'In progress', description: 'Started overview' },
  { id: 'photos', label: 'Photos', description: 'Open directly on room photos' },
  { id: 'supplies', label: 'Supplies', description: 'Open directly on supply levels' },
  { id: 'maintenance', label: 'Maintenance', description: 'Open directly on maintenance' },
  { id: 'guest', label: 'Guest condition', description: 'Open directly on the final step' },
];

export function DevScenarios() {
  const catalog = useResource(signal => request<Catalog>('/dev/scenarios', { signal }));
  const [propertyId, setPropertyId] = useState('');
  const [cleanerId, setCleanerId] = useState('');
  const [step, setStep] = useState<Step>('photos');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [created, setCreated] = useState<{ jobId: string; propertyName: string; cleanerName: string; cleanerPath: string }>();
  const selectedProperty = catalog.data?.properties.find(item => item.id === propertyId);
  const cleaners = catalog.data?.cleaners.filter(cleaner => !selectedProperty || cleaner.cityId === selectedProperty.cityId) ?? [];
  async function create() {
    if (!propertyId || !cleanerId || busy) return;
    setBusy(true); setError(undefined); setCreated(undefined);
    try { setCreated(await request('/dev/scenarios', { body: { propertyId, cleanerId, step } })); }
    catch (failure) { setError(failure); }
    finally { setBusy(false); }
  }
  async function copy() {
    if (!created) return;
    try { await navigator.clipboard.writeText(`${window.location.origin}${created.cleanerPath}`); }
    catch { setError(new ApiError('NETWORK_ERROR', 'Could not copy the cleaner preview link.')); }
  }
  return <section className="bloom-admin-card bloom-form" aria-label="Development scenarios">
    <h2>Development scenarios</h2>
    <p>Local and staging test data only. This creates a real assigned job and can place the selected cleaner directly on a journey step.</p>
    {catalog.loading ? <Loading /> : catalog.error ? <ErrorNotice error={catalog.error} retry={catalog.reload} /> : <>
      <label>Property<Select value={propertyId} onChange={event => { setPropertyId(event.target.value); setCleanerId(''); }}><option value="">Choose a configured property</option>{catalog.data?.properties.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</Select></label>
      <label>Cleaner<Select value={cleanerId} disabled={!propertyId} onChange={event => setCleanerId(event.target.value)}><option value="">Choose a cleaner</option>{cleaners.map(cleaner => <option key={cleaner.id} value={cleaner.id}>{cleaner.name}</option>)}</Select></label>
      <label>Open cleaner at<Select value={step} onChange={event => setStep(event.target.value as Step)}>{steps.map(item => <option key={item.id} value={item.id}>{item.label} — {item.description}</option>)}</Select></label>
      <button type="button" className="bloom-button" disabled={!propertyId || !cleanerId || busy} onClick={create}>{busy ? 'Creating scenario…' : 'Create scenario'}</button>
    </>}
    {created && <div className="bloom-notice"><strong>{created.propertyName}</strong> is assigned to {created.cleanerName}. Sign in as that cleaner, then open this preview link.<br /><code>{created.cleanerPath}</code><div className="bloom-actions"><button type="button" className="bloom-button secondary" onClick={copy}>Copy cleaner preview link</button></div></div>}
    {!!error && <ErrorNotice error={error} />}
  </section>;
}
