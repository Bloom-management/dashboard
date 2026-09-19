import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { accountDiagnostics, safeFailure, type AccountDiagnostic } from './account-diagnostics';

const token = 'SYNTHETIC_SECRET_CURRENT_TOKEN';
const secret = 'SYNTHETIC_SECRET_NEVER_LOG';
const mapped = { id: '00000000-0000-4000-8000-000000000001', role: 'admin', displayName: 'Synthetic', approvedCityId: null };
async function lookup(implementation: typeof fetch) {
  const events: AccountDiagnostic[] = [];
  const trace = accountDiagnostics(event => events.push(event));
  const db = createClient('http://127.0.0.1:55441', 'synthetic-publishable-key', {
    accessToken: async () => token,
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: trace.observeFetch('http://127.0.0.1:55441', token, implementation) },
  });
  const result = await db.rpc('bloom_me');
  const diagnostic = trace.lookup(result);
  assert.ok(!JSON.stringify(events).includes(secret));
  assert.ok(!JSON.stringify(events).includes(token));
  return { result, diagnostic, events };
}
test('real SDK flattens refused fetch to status zero; observer retains safe nested cause codes', async () => {
  const refusal = Object.assign(new Error(secret), { code: 'ECONNREFUSED', address: secret, port: 9999 });
  const failure = new TypeError(`fetch failed ${secret}`, { cause: new AggregateError([refusal], secret) });
  const { result, diagnostic } = await lookup(async () => { throw failure; });
  assert.equal(result.status, 0); assert.equal(result.error?.code, '');
  assert.equal(diagnostic.phase, 'fetch_exception'); assert.equal(diagnostic.httpStatus, null);
  assert.equal(diagnostic.databaseCode, null); assert.equal(diagnostic.missingAccount, false);
  assert.deepEqual(diagnostic.failure.codes, ['ECONNREFUSED']);
  assert.equal(diagnostic.originalTokenForwarded, true);
});
test('this SDK preserves HTTP 200 for malformed JSON and reports a response-processing failure', async () => {
  const { result, diagnostic } = await lookup(async () => new Response(`<html>${secret}</html>`, { status: 200 }));
  assert.equal(result.status, 200); assert.equal(diagnostic.httpStatus, 200);
  assert.equal(diagnostic.phase, 'response_processing_failure');
  assert.equal(diagnostic.mapped, false);
});
test('a failed response body read is distinguished from failure to receive HTTP headers', async () => {
  const { diagnostic } = await lookup(async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error(secret)); } }), { status: 200 }));
  assert.equal(diagnostic.phase, 'response_processing_failure'); assert.equal(diagnostic.httpStatus, 200);
});
test('actual PostgREST missing-account response and gateway failures stay distinct', async () => {
  const missing = await lookup(async () => Response.json({ code: 'P0001', message: 'UNAUTHENTICATED' }, { status: 400 }));
  assert.equal(missing.diagnostic.phase, 'missing_account'); assert.equal(missing.diagnostic.missingAccount, true);
  for (const [status, code] of [[401, 'PGRST301'], [403, '42501'], [404, 'PGRST202'], [503, 'PGRST002']] as const) {
    const { diagnostic } = await lookup(async () => Response.json({ code, message: secret, details: secret }, { status }));
    assert.equal(diagnostic.phase, 'http_error'); assert.equal(diagnostic.httpStatus, status);
    assert.equal(diagnostic.databaseCode, code); assert.equal(diagnostic.missingAccount, false);
  }
});
test('valid mapping requires accepted response and a SessionUser DTO, with exact current token forwarding', async () => {
  const success = await lookup(async () => Response.json(mapped));
  assert.equal(success.diagnostic.phase, 'mapped'); assert.equal(success.diagnostic.originalTokenForwarded, true);
  for (const payload of [null, {}, { ...mapped, role: 'invented' }]) {
    const invalid = await lookup(async () => Response.json(payload));
    assert.equal(invalid.diagnostic.phase, 'invalid_account_payload'); assert.equal(invalid.diagnostic.mapped, false);
  }
});
test('configuration failures record a safe stage before any request', () => {
  const events: AccountDiagnostic[] = []; const trace = accountDiagnostics(event => events.push(event));
  trace.configurationFailure('client_initialization', Object.assign(new TypeError(secret), { code: 'ERR_INVALID_URL' }));
  assert.equal(events[0].phase, 'configuration'); assert.equal(events[0].attempts, 0);
  assert.equal(events[0].httpStatus, null); assert.deepEqual(events[0].failure.codes, ['ERR_INVALID_URL']);
  assert.ok(!JSON.stringify(events).includes(secret));
});
test('sanitizer bounds cyclic causes, ignores attacker-controlled strings, and logging failures are harmless', async () => {
  const cyclic: Record<string, unknown> = { name: secret, code: secret, message: secret }; cyclic.cause = cyclic;
  assert.deepEqual(safeFailure(cyclic), { names: [], codes: [] });
  const trace = accountDiagnostics(() => { throw new Error(secret); });
  const wrapped = trace.observeFetch(`https://${secret}.example.invalid`, token, async () => Response.json(mapped));
  assert.equal((await wrapped('https://synthetic.example.invalid')).status, 200);
  const result = trace.lookup({ status: 200, data: mapped, error: null });
  assert.equal(result.mapped, true); assert.ok(!JSON.stringify(result).includes(secret));
});
