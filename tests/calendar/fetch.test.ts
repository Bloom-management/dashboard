import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import dns from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fetchCalendar } from '../../src/server/calendar/fetch';
const url = 'https://www.airbnb.com/calendar/ical/1.ics?t=synthetic';
function fakeResponse(status: number, body: string, headers: Record<string,string> = {}, complete = true) {
  let calls = 0;
  mock.method(https, 'get', (_url: URL, options: {lookup: (host:string, options:{all:boolean}, callback:(error:unknown, addresses:unknown)=>void)=>void}, callback: (response:PassThrough)=>void) => {
    calls++;
    options.lookup('www.airbnb.com', { all: true }, (error: unknown, addresses: unknown) => {
      assert.equal(error, null); assert.deepEqual(addresses, [{ address:'8.8.8.8', family:4 }]);
    });
    const request = new EventEmitter();
    queueMicrotask(() => {
      const response = new PassThrough() as PassThrough & { statusCode: number; headers: unknown; complete: boolean };
      response.statusCode = status; response.headers = headers; response.complete = complete;
      callback(response); response.end(body);
    });
    return request;
  });
  return () => calls;
}
test('fetch validates/pins DNS, refuses redirects, bounds bytes and rejects partial responses', async () => {
  mock.method(dns, 'lookup', async () => [{ address:'8.8.8.8', family:4 }]);
  try {
    const calls = fakeResponse(302, '', { location:'https://127.0.0.1/private' });
    await assert.rejects(fetchCalendar(url, 'airbnb'), { code:'FETCH_HTTP' }); assert.equal(calls(), 1);
    fakeResponse(200, 'too big', { 'content-length':'1048577' });
    await assert.rejects(fetchCalendar(url, 'airbnb'), { code:'FETCH_TOO_LARGE' });
    fakeResponse(200, 'a'.repeat(1048577));
    await assert.rejects(fetchCalendar(url, 'airbnb'), { code:'FETCH_TOO_LARGE' });
    fakeResponse(200, 'truncated', {}, false);
    await assert.rejects(fetchCalendar(url, 'airbnb'), { code:'FETCH_FAILED' });
    fakeResponse(200, 'compressed', { 'content-encoding':'gzip' });
    await assert.rejects(fetchCalendar(url, 'airbnb'), { code:'FETCH_HTTP' });
    fakeResponse(304, ''); assert.equal((await fetchCalendar(url, 'airbnb', { etag:'"safe"' })).status, 304);
    fakeResponse(200, 'BEGIN:VCALENDAR\nEND:VCALENDAR');
    assert.equal((await fetchCalendar(url, 'airbnb')).status, 200);
  } finally { mock.restoreAll(); }
});
test('mixed public/private DNS fails before any connection', async () => {
  mock.method(dns, 'lookup', async () => [{ address:'8.8.8.8', family:4 }, { address:'127.0.0.1', family:4 }]);
  const connection = mock.method(https, 'get', () => { throw new Error('must not connect'); });
  try { await assert.rejects(fetchCalendar(url, 'airbnb'), { code:'UNSAFE_ADDRESS' }); assert.equal(connection.mock.callCount(), 0); }
  finally { mock.restoreAll(); }
});
test('network exceptions are redacted', async () => {
  mock.method(dns, 'lookup', async () => { throw new Error(url); });
  try { await assert.rejects(fetchCalendar(url, 'airbnb'), { message:'FETCH_FAILED' }); }
  finally { mock.restoreAll(); }
});
test('DNS resolution has a total deadline, even when resolver never returns', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  mock.method(dns, 'lookup', () => new Promise(() => {}));
  try {
    const pending = fetchCalendar(url, 'airbnb');
    context.mock.timers.tick(15_000);
    await assert.rejects(pending, { code:'FETCH_TIMEOUT' });
  } finally { mock.restoreAll(); context.mock.timers.reset(); }
});
