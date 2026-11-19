'use client';
/** Small admin form helpers shared by the admin hub and its panels. */
import {useCallback,useRef,useState,type ReactNode} from 'react';
import {ApiError} from './api';
import type {Page} from './integration';
import {ErrorNotice,Loading,useResource} from './primitives';

export type Run = (input: unknown, operation: (key: string) => Promise<unknown>) => Promise<boolean>;
export function useMutation(): { busy: boolean; error: unknown; success: boolean; run: Run } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [success, setSuccess] = useState(false);
  const receipt = useRef<{ input: string; key: string } | null>(null);
  const lock = useRef(false);
  const run: Run = async (input, operation) => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(undefined); setSuccess(false);
    const hash = JSON.stringify(input);
    if (receipt.current?.input !== hash) receipt.current = { input: hash, key: crypto.randomUUID() };
    try { await operation(receipt.current.key); receipt.current = null; setSuccess(true); return true; }
    catch (failure) { setError(failure); if (failure instanceof ApiError && !['NETWORK_ERROR', 'SOURCE_UNAVAILABLE', 'SERVICE_UNAVAILABLE'].includes(failure.code)) receipt.current = null; return false; }
    finally { lock.current = false; setBusy(false); }
  };
  return { busy, error, success, run };
}
export function Result({ mutation }: { mutation: ReturnType<typeof useMutation> }) {
  return <>{!!mutation.error && <ErrorNotice error={mutation.error} />}{mutation.success && <p role="status">Saved.</p>}</>;
}
export function Paginated<T>({ loader, render }: { loader: (cursor: string | null, signal: AbortSignal) => Promise<Page<T>>; render: (items: T[], reload: () => void) => ReactNode }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const load = useCallback((signal: AbortSignal) => loader(cursor, signal), [loader, cursor]);
  const resource = useResource(load);
  return <>{resource.loading ? <Loading /> : resource.error ? <ErrorNotice error={resource.error} retry={resource.reload} /> : resource.data && <>{render(resource.data.items, resource.reload)}<div className="bloom-actions"><button type="button" className="bloom-button secondary" disabled={!history.length} onClick={() => { setCursor(history[history.length - 1]); setHistory(previous => previous.slice(0, -1)); }}>Previous page</button><button type="button" className="bloom-button secondary" disabled={!resource.data.nextCursor} onClick={() => { setHistory(previous => [...previous, cursor]); setCursor(resource.data!.nextCursor); }}>Next page</button></div></>}</>;
}
