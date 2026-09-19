/** Explicit foreground, LOCAL-only Airbnb polling. Importing this module never starts a worker. */
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { CalendarError, safeCode } from './errors';
import { CalendarService } from './service';
import { rpcStore, serviceRpc } from './store';
import type { SyncOutcome } from './types';

type WorkerOptions = { sourceId: string; intervalSeconds: number };
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
export function workerOptions(args: string[]): WorkerOptions {
  if ((args.length !== 2 && args.length !== 4) || args[0] !== '--airbnb-source' || !uuid.test(args[1]) ||
      (args.length === 4 && (args[2] !== '--interval-seconds' || !/^\d+$/.test(args[3])))) throw new CalendarError('VALIDATION_ERROR', 400);
  const intervalSeconds = args.length === 4 ? Number(args[3]) : 300;
  if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 60 || intervalSeconds > 86_400) throw new CalendarError('VALIDATION_ERROR', 400);
  return { sourceId: args[1], intervalSeconds };
}
export function requireLocalDatabase(base: string | undefined) {
  try {
    const url = new URL(base || '');
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
  } catch { throw new CalendarError('CONFIGURATION_ERROR', 503); }
}
export type WorkerReport = { sourceId: string; status: 'success' | 'partial' | 'not_modified' | 'failed';
  errorCode?: string; created?: number; updated?: number; removed?: number; unchanged?: number; conflicts?: number };
/** One awaited run at a time, then an interruptible delay. DB leases fence multiple processes.
 * Stop allows an in-flight bounded sync to finish; it never abandons a transaction or starts another run. */
export async function runWorker(options: WorkerOptions, signal: AbortSignal, dependencies: {
  sync: (sourceId: string, key: string, expected: { provider: 'airbnb' }) => Promise<SyncOutcome>;
  report: (result: WorkerReport) => void;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}) {
  const wait = dependencies.wait ?? (async (milliseconds, signal) => { await delay(milliseconds, undefined, { signal }); });
  while (!signal.aborted) {
    try {
      const outcome = await dependencies.sync(options.sourceId, randomUUID(), { provider: 'airbnb' });
      // Never log arbitrary RPC objects, payloads, event identities, URLs or raw errors.
      dependencies.report({ sourceId: options.sourceId, status: outcome.status, created: outcome.created,
        updated: outcome.updated, removed: outcome.removed, unchanged: outcome.unchanged, conflicts: outcome.conflicts });
    } catch (error) {
      const code = safeCode(error);
      const allowed = ['FETCH_TIMEOUT','FETCH_FAILED','FETCH_HTTP','UNSAFE_URL','UNSAFE_ADDRESS','FETCH_TOO_LARGE',
        'INVALID_CALENDAR','PARTIAL_CALENDAR','CONFIGURATION_ERROR','CONFLICT','SOURCE_DISABLED','NOT_FOUND','VALIDATION_ERROR','SYNC_FAILED'];
      dependencies.report({ sourceId: options.sourceId, status: 'failed', errorCode: allowed.includes(code) ? code : 'SYNC_FAILED' });
    }
    if (signal.aborted) return;
    try { await wait(options.intervalSeconds * 1000, signal); }
    catch (error) { if (!signal.aborted) throw error; }
  }
}
async function main() {
  const options = workerOptions(process.argv.slice(2));
  requireLocalDatabase(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  // Managed launchers can be killed without forwarding a signal. Never leave an orphan poller.
  const parent = Number(process.env.BLOOM_LOCAL_LAUNCHER_PID);
  const watchdog = Number.isSafeInteger(parent) && parent > 1 ? setInterval(() => {
    try { process.kill(parent, 0); } catch { stop(); }
  }, 1000) : undefined;
  try {
    const service = new CalendarService(rpcStore(serviceRpc(), null));
    await runWorker(options, controller.signal, { sync: service.sync.bind(service),
      report: result => process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...result })}\n`) });
  } finally { clearInterval(watchdog); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stderr.write('Calendar worker could not start. Check the local database configuration and --airbnb-source <source-uuid> [--interval-seconds 300].\n'); process.exitCode = 1; });
}
