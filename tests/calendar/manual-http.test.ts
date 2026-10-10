import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { calendarActionResponse, calendarExportUrl, exportTokenHash } from '../../src/server/calendar/manual-http';

test('export URLs are HTTPS and tokens have exactly 256-bit hex shape', () => {
  const token = 'a'.repeat(64);
  assert.equal(calendarExportUrl(token, 'https://admin.bloomcleaning.org'), `https://admin.bloomcleaning.org/api/calendar/export/${token}.ics`);
  assert.equal(exportTokenHash(`${token}.ics`), createHash('sha256').update(token).digest('hex'));
  for (const bad of [token, `${token}.ics/extra`, `${'z'.repeat(64)}.ics`, `${token.slice(1)}.ics`]) assert.equal(exportTokenHash(bad), null);
  assert.throws(() => calendarExportUrl(token, 'http://localhost:3000'));
  assert.throws(() => calendarExportUrl(token, 'https://user:pass@example.org'));
  assert.throws(() => calendarExportUrl('bad', 'https://example.org'));
  assert.equal(calendarExportUrl(null, undefined), null);
});
test('structured conflicts expose actionable details and preserve request tracing', async () => {
  const response = await calendarActionResponse(Response.json({ data: { ok: false, conflict: {
    code: 'OCCUPIED_NIGHT', message: 'One night is unavailable.', details: { dates: ['2026-10-02'], reason: 'ignored' },
  } } }, { headers: { 'X-Request-Id': 'trace', 'Cache-Control': 'private, no-store' } }));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error.code, 'CONFLICT');
  assert.equal(body.error.details.reason, 'OCCUPIED_NIGHT');
  assert.equal(body.error.requestId, 'trace');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});
test('successful and authorization responses are unchanged', async () => {
  for (const response of [Response.json({ data: { ok: true, id: 'job' } }), Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 })]) {
    assert.equal(await calendarActionResponse(response), response);
  }
});
