import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runWorker, workerOptions, requireLocalDatabase, type WorkerReport } from '../../src/server/calendar/worker';
import { CalendarError } from '../../src/server/calendar/errors';
const sourceId = '00000000-0000-4000-8000-000000000001';
const outcome = { runId: 'synthetic', status: 'success' as const, created: 1, updated: 0, removed: 0, unchanged: 0, conflicts: 0 };
test('worker is opt-in, one Airbnb source, bounded interval, local database only', () => {
  assert.deepEqual(workerOptions(['--airbnb-source', sourceId]), { sourceId, intervalSeconds: 300 });
  assert.equal(workerOptions(['--airbnb-source', sourceId, '--interval-seconds', '60']).intervalSeconds, 60);
  for (const args of [[], ['--all'], ['--airbnb-source', 'https://private.invalid'], ['--airbnb-source',sourceId,'--interval-seconds','0'], ['--airbnb-source',sourceId,'--interval-seconds','90001']]) assert.throws(() => workerOptions(args));
  for (const base of [undefined, 'https://hosted.invalid', 'http://127.0.0.1.evil.invalid', 'http://user:secret@localhost', 'http://localhost/?secret=value']) assert.throws(() => requireLocalDatabase(base));
  requireLocalDatabase('http://127.0.0.1:55441'); requireLocalDatabase('http://localhost:55441');
});
test('worker awaits each run, retries with a fresh key, includes Airbnb guard, and emits no arbitrary secrets', async () => {
  const controller = new AbortController(); const keys: string[] = []; const reports: WorkerReport[] = []; let running = false;
  await runWorker({ sourceId, intervalSeconds: 900 }, controller.signal, {
    sync: async (id, key, expected) => {
      assert.equal(id, sourceId); assert.deepEqual(expected, { provider: 'airbnb' }); assert.equal(running, false);
      running = true; keys.push(key);
      await Promise.resolve(); running = false;
      if (keys.length === 1) throw new Error('private export token must not escape');
      return { ...outcome, encryptedUrl: 'secret', rawUrl: 'secret' };
    }, report: result => reports.push(result),
    wait: async milliseconds => { assert.equal(running, false); assert.equal(milliseconds, 900_000); if (keys.length === 2) controller.abort(); },
  });
  assert.equal(keys.length, 2); assert.notEqual(keys[0], keys[1]);
  assert.equal(reports[0].errorCode, 'SYNC_FAILED'); assert.equal(reports[1].created, 1);
  assert(!JSON.stringify(reports).includes('secret')); assert(!JSON.stringify(reports).includes('private'));
});
test('stop during an in-flight sync finishes that run without another poll', async () => {
  const controller = new AbortController(); let runs = 0;
  await runWorker({ sourceId, intervalSeconds: 900 }, controller.signal, {
    sync: async () => { runs++; controller.abort(); return { ...outcome, status: 'partial' }; },
    report: result => assert.equal(result.status, 'partial'),
    wait: async () => assert.fail('Stopping must not enter another wait/poll'),
  });
  assert.equal(runs, 1);
});
test('stopped worker does no work and cancelled wait is handled cleanly', async () => {
  const controller = new AbortController(); controller.abort();
  await runWorker({ sourceId, intervalSeconds: 900 }, controller.signal, {
    sync: async () => assert.fail('No sync after stop'), report: () => assert.fail('No report after stop'),
  });
  const next = new AbortController();
  await runWorker({ sourceId, intervalSeconds: 900 }, next.signal, {
    sync: async () => { throw new CalendarError('FETCH_TIMEOUT'); }, report: result => assert.equal(result.errorCode, 'FETCH_TIMEOUT'),
    wait: async () => { next.abort(); throw new Error('aborted'); },
  });
});
test('worker CLI rejects a hosted target without network or exposing configuration values', () => {
  const result = spawnSync(process.execPath, ['--import','tsx','src/server/calendar/worker.ts','--airbnb-source',sourceId], {
    encoding: 'utf8', timeout: 10_000, env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'https://secret-host.invalid', SUPABASE_SERVICE_ROLE_KEY: 'secret-key' },
  });
  assert.equal(result.status, 1); assert(!result.stderr.includes('secret')); assert.equal(result.stdout, '');
});
