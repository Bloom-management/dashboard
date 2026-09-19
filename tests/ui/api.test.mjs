import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError, request } from '../../src/components/bloom/api.ts';

test('mutations use same-origin auth, a caller-retained key, and no actor payload', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json({ data: { id: 'synthetic-job' } }); };
  try {
    await api.jobAction('synthetic-job', 'claim', 'same-retry-key');
    await api.jobAction('synthetic-job', 'claim', 'same-retry-key');
    assert.equal(calls[0].url, '/api/jobs/synthetic-job/claim');
    assert.equal(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key']);
    assert.equal(calls[0].options.credentials, 'same-origin');
    assert.equal(calls[0].options.redirect, 'error');
    assert.deepEqual(JSON.parse(calls[0].options.body), {});
  } finally { globalThis.fetch = original; }
});
test('server conflict and role denials remain failures, never optimistic success', async () => {
  const original = globalThis.fetch;
  try {
    for (const [status, code] of [[409, 'JOB_FULL'], [403, 'FORBIDDEN'], [401, 'UNAUTHENTICATED']]) {
      globalThis.fetch = async () => Response.json({ error: { code, message: 'Safe server message', requestId: 'test-request' } }, { status });
      await assert.rejects(request('/jobs'), error => error instanceof ApiError && error.code === code && error.requestId === 'test-request');
    }
  } finally { globalThis.fetch = original; }
});
test('unclassified service failures do not diagnose configuration or return fixture data', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('<html>Not configured</html>', { status: 503 });
    await assert.rejects(api.me(), error => error.code === 'SOURCE_UNAVAILABLE');
    globalThis.fetch = async () => { throw new TypeError('offline'); };
    await assert.rejects(api.me(), error => error.code === 'NETWORK_ERROR');
  } finally { globalThis.fetch = original; }
});

test('only an explicit backend configuration category establishes configuration failure', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: { code: 'CONFIGURATION_ERROR', message: 'Confirmed service setting problem.', requestId: 'configuration-test' } }, { status: 503 });
    await assert.rejects(api.me(), error => error.code === 'CONFIGURATION_ERROR' && error.requestId === 'configuration-test');
    for (const body of [{}, { error: null }, { error: { message: 'Unknown failure' } }]) {
      globalThis.fetch = async () => Response.json(body, { status: 503 });
      await assert.rejects(api.me(), error => error.code === 'SOURCE_UNAVAILABLE');
    }
    globalThis.fetch = async () => new Response(null, { status: 403 });
    await assert.rejects(api.me(), error => error.code === 'FORBIDDEN');
  } finally { globalThis.fetch = original; }
});
