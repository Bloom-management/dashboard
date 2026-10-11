'use client';

import { useRef, useState } from 'react';
import { ApiError } from './api';
import { ErrorNotice, Modal } from './primitives';
import type { BloomIntegration } from './integration';

export function PropertyName({ property, rename, onSaved }: {
  property: { id: string; name: string };
  rename: BloomIntegration['renameProperty'];
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(property.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const operation = useRef<{ name: string; key: string } | null>(null);
  const locked = useRef(false);
  const trigger=<button type="button" className="property-name-edit" aria-label={`Rename ${property.name}`} title="Rename property" disabled={!rename} onClick={() => { setName(property.name); setError(undefined); setEditing(true); }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6L16 3ZM14 5l5 5"/></svg></button>;
  if (!editing) return trigger;
  return <>{trigger}<Modal title="Rename property" onClose={()=>{if(!busy)setEditing(false);}}><form className="bloom-form" aria-busy={busy} onSubmit={async event => {
    event.preventDefault();
    const value = name.trim();
    if (!rename || !value || value.length > 200 || locked.current) return;
    locked.current = true; setBusy(true); setError(undefined);
    if (operation.current?.name !== value) operation.current = { name: value, key: crypto.randomUUID() };
    try {
      await rename(property.id, value, operation.current.key);
      operation.current = null; setEditing(false); onSaved();
    } catch (failure) {
      setError(failure);
      if (failure instanceof ApiError && !['NETWORK_ERROR', 'SOURCE_UNAVAILABLE', 'SERVICE_UNAVAILABLE'].includes(failure.code)) operation.current = null;
    } finally { locked.current = false; setBusy(false); }
  }}>
    <label>Property name<input autoFocus required maxLength={200} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
    <div className="bloom-actions"><button className="bloom-button" disabled={busy || !name.trim() || name.trim() === property.name}>{busy ? 'Saving…' : 'Save name'}</button><button type="button" className="bloom-button secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</button></div>
    {!!error && <ErrorNotice error={error} />}
  </form></Modal></>;
}
