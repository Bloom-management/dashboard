import { BackendError } from './errors';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mutation, dateRange, response, trustedMutationOrigin } from './http';
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
function request(body: string, origin = 'http://localhost:3000', key = 'test') {
  return new Request('http://localhost:3000/api/jobs/test/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'Idempotency-Key': key }, body });
}
test('mutation checks same origin, idempotency key and unknown fields', async () => {
  assert.deepEqual(await mutation(request('{}'), []), { body: {}, key: 'test' });
  await assert.rejects(mutation(request('{}', 'https://other.example'), []), /FORBIDDEN/);
  await assert.rejects(mutation(request('{}', 'http://localhost:3000', ''), []), /VALIDATION_ERROR/);
  await assert.rejects(mutation(request('{"role":"admin"}'), []), /VALIDATION_ERROR/);
  await assert.rejects(mutation(request('[]'), []), /VALIDATION_ERROR/);
  await assert.rejects(mutation(request('{'), []), /VALIDATION_ERROR/);
  await assert.rejects(mutation(request(' '.repeat(16_385)), []), /VALIDATION_ERROR/);
});
test('date ranges are valid and at most 93 inclusive days', () => {
  assert.deepEqual(dateRange(new Request('http://localhost/?from=2026-01-01&to=2026-04-03')), ['2026-01-01', '2026-04-03']);
  for (const query of ['from=2026-02-30&to=2026-03-01', 'from=2026-01-01&to=2026-04-04', 'from=2026-03-01&to=2026-01-01', '']) {
    assert.throws(() => dateRange(new Request(`http://localhost/?${query}`)), /VALIDATION_ERROR/);
  }
});
test('HTTP failures never expose underlying SQL or secrets', async () => {
  const result = await response(async () => { throw new Error('SQL with a synthetic secret'); });
  assert.equal(result.status, 503);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  const body = await result.json();
  assert.equal(body.error.code, 'CONFIGURATION_ERROR');
  assert.ok(body.error.requestId);
  assert.ok(!JSON.stringify(body).includes('synthetic secret'));
});

test('conditional calendar reads authorize before 304 and detect changed content', async () => {
  const first = await response(async () => ['booking'], new Request('http://localhost/api/jobs'));
  const etag = first.headers.get('etag')!;
  assert.ok(etag);
  const request = new Request('http://localhost/api/jobs', {headers:{'If-None-Match':etag}});
  assert.equal((await response(async () => ['booking'], request)).status,304);
  assert.equal((await response(async () => ['changed'], request)).status,200);
  assert.equal((await response(async () => { throw new BackendError('UNAUTHENTICATED'); }, request)).status,401);
});

test('development loopback aliases share the configured port without allowing foreign origins', async () => {
  assert.equal(trustedMutationOrigin('http://localhost:3000', 'http://127.0.0.1:3000', true), true);
  assert.equal(trustedMutationOrigin('http://127.0.0.1:3000', 'http://localhost:3000', true), true);
  for (const origin of [null, 'null', 'http://localhost:3001', 'http://127.0.0.1:3001', 'https://localhost:3000', 'http://localhost.evil.test:3000', 'http://127.0.0.2:3000', 'https://other.example']) {
    assert.equal(trustedMutationOrigin(origin, 'http://127.0.0.1:3000', true), false);
  }
  assert.equal(trustedMutationOrigin('http://localhost:3000', 'http://127.0.0.1:3000', false), false);
  assert.equal(trustedMutationOrigin('http://localhost:3000', 'https://admin.example.test', true), false);
  assert.equal(trustedMutationOrigin('https://admin.example.test', 'https://admin.example.test', false), true);
  const crossSite = request('{}');
  crossSite.headers.set('sec-fetch-site', 'cross-site');
  await assert.rejects(mutation(crossSite, []), /FORBIDDEN/);
});
