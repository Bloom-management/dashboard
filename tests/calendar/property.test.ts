import { test } from 'node:test';
import assert from 'node:assert/strict';
import { propertyCalendarService } from '../../src/server/calendar/property';
import { CalendarService } from '../../src/server/calendar/service';
import { rpcStore, type Rpc } from '../../src/server/calendar/store';
import { protectUrl } from '../../src/server/calendar/secrets';
import { actions } from '../../src/server/calendar/errors';
const property = '00000000-0000-4000-8000-000000000010';
const other = '00000000-0000-4000-8000-000000000020';
const actor = '00000000-0000-4000-8000-000000000001';
const id = '00000000-0000-4000-8000-000000000030';
const health = { id, propertyId: property, provider: 'airbnb', enabled: true, lastSuccessAt: null, lastAttemptAt: null, errorCode: null, action: null };
const url = 'https://www.airbnb.com/calendar/ical/1.ics?t=synthetic';
function harness(handler: (name: string, args: Record<string, unknown>) => unknown) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc: Rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    calls.push({ name, args }); return await handler(name, args) as T;
  };
  const neverFetch = async (): Promise<never> => { assert.fail('No feed may be fetched in this test'); };
  return { calls, rpc, service: propertyCalendarService(property, actor, rpc, neverFetch) };
}
test('selected property creation uses path ID, integrated RPC names and encrypted fields; output is redacted', async () => {
  const saved = process.env.CALENDAR_ENCRYPTION_KEY; process.env.CALENDAR_ENCRYPTION_KEY = 'ab'.repeat(32);
  try {
    const { service, calls } = harness((name, args) => {
      if (name === 'bloom_calendar_property_sources') return { items: [], nextCursor: null };
      assert.equal(name, 'bloom_calendar_add_source');
      const input = args.p_input as Record<string, string>;
      assert.deepEqual(Object.keys(input).sort(), ['propertyId','provider','encryptedUrl','fingerprint','urlDigest'].sort());
      assert.equal(input.propertyId, property); assert.equal(input.provider, 'airbnb');
      assert(!JSON.stringify(args).includes(url)); assert(!JSON.stringify(args).includes('ab'.repeat(32)));
      assert.match(input.encryptedUrl, /^v1\./); assert.equal(args.p_key, 'create-key');
      return { ...health, encryptedUrl: input.encryptedUrl, urlDigest: input.urlDigest, url };
    });
    const result = await service.add('airbnb', url, 'create-key');
    assert.equal(result.propertyId, property); assert.equal(result.errorMessage, null);
    assert.deepEqual(calls[0], { name: 'bloom_calendar_property_sources', args: { p_actor: actor, p_property: property, p_cursor: null } });
    assert.equal(calls[1].args.p_actor, actor);
    assert.deepEqual(Object.keys(result).sort(), ['id','propertyId','provider','enabled','lastSuccessAt','lastAttemptAt','errorMessage'].sort());
  } finally { if (saved === undefined) delete process.env.CALENDAR_ENCRYPTION_KEY; else process.env.CALENDAR_ENCRYPTION_KEY = saved; }
});
test('health listing needs no encryption material and strips page/row secrets and unknown errors', async () => {
  const saved = process.env.CALENDAR_ENCRYPTION_KEY; delete process.env.CALENDAR_ENCRYPTION_KEY;
  try {
    for (const errorCode of ['CONFIGURATION_ERROR', 'toString', 'https://secret.invalid/private']) {
      const { service, calls } = harness(() => ({ items: [{ ...health, errorCode, encryptedUrl: 'private' }], nextCursor: id, secret: 'private' }));
      const page = await service.list(other);
      assert.equal(calls[0].args.p_cursor, other);
      assert.equal(page.items[0].errorMessage, Object.hasOwn(actions, errorCode) ? actions[errorCode] : actions.SYNC_FAILED);
      assert.deepEqual(Object.keys(page).sort(), ['items','nextCursor']); assert(!JSON.stringify(page).includes('private'));
    }
  } finally { if (saved !== undefined) process.env.CALENDAR_ENCRYPTION_KEY = saved; }
});
test('wrong-property source is 404 without begin/decryption/fetch; foreign list rows fail closed', async () => {
  for (const items of [[], [{ ...health, propertyId: other }]]) {
    const { service, calls } = harness(() => ({ items, nextCursor: null }));
    await assert.rejects(service.sync(id, 'retry-key'), { code: 'NOT_FOUND', status: 404 });
    assert.equal(calls.length, 1);
  }
});
test('disabled synthetic source rejects before begin; global service also refuses a disabled lease', async () => {
  const { service, calls, rpc } = harness(name => {
    if (name === 'bloom_calendar_property_sources') return { items: [{ ...health, enabled: false }], nextCursor: null };
    if (name === 'bloom_calendar_begin_sync') return { runId: 'run', version: 1, source: { ...health, enabled: false, encryptedUrl: 'deliberately-invalid' } };
    assert.equal(name, 'bloom_calendar_fail_sync'); return undefined;
  });
  await assert.rejects(service.sync(id, 'retry-key'), { code: 'CONFLICT', status: 409 }); assert.equal(calls.length, 1);
  await assert.rejects(new CalendarService(rpcStore(rpc, actor), async () => { assert.fail('No feed fetch'); }).sync(id, 'global'), { code: 'SOURCE_DISABLED' });
});
test('membership lookup paginates within selected property then uses existing begin RPC; retries replay', async () => {
  const outcome = { runId: 'run', status: 'success', created: 0, updated: 0, removed: 0, unchanged: 1, conflicts: 0 };
  const { service, calls } = harness((name, args) => {
    if (name === 'bloom_calendar_property_sources') return args.p_cursor ? { items: [health], nextCursor: null } : { items: [], nextCursor: other };
    assert.equal(name, 'bloom_calendar_begin_sync'); assert.deepEqual(args, { p_actor: actor, p_source: id, p_key: 'retry' });
    return { result: outcome };
  });
  assert.deepEqual(await service.sync(id, 'retry'), outcome);
  assert.deepEqual(await service.sync(id, 'retry'), outcome);
  assert(calls.filter(c => c.name === 'bloom_calendar_property_sources').every(c => c.args.p_property === property));
});
test('scoped sync leaves blocked classification intact and surfaces backend gate with failed-run bookkeeping', async () => {
  const saved = process.env.CALENDAR_ENCRYPTION_KEY; process.env.CALENDAR_ENCRYPTION_KEY = 'ab'.repeat(32);
  try {
    const { CalendarError } = await import('../../src/server/calendar/errors');
    const source = { ...health, provider: 'vrbo', timezone: 'America/Detroit', syncVersion: 1, ...protectUrl('https://www.vrbo.com/icalendar/abc.ics', 'vrbo', property) };
    const { rpc, calls } = harness((name, args) => {
      if (name === 'bloom_calendar_property_sources') return { items: [source], nextCursor: null };
      if (name === 'bloom_calendar_begin_sync') return { runId: 'run', version: 1, source };
      if (name === 'bloom_calendar_finish_sync') {
        assert.equal((args.p_snapshot as { events: { kind: string }[] }).events[0].kind, 'blocked');
        throw new CalendarError('CONFIGURATION_ERROR', 503);
      }
      assert.equal(name, 'bloom_calendar_fail_sync'); assert.equal(args.p_code, 'CONFIGURATION_ERROR');
    });
    const service = propertyCalendarService(property, actor, rpc, async () => ({ status: 200, body: 'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:synthetic\nDTSTART;VALUE=DATE:20300101\nDTEND;VALUE=DATE:20300103\nSUMMARY:Blocked\nEND:VEVENT\nEND:VCALENDAR' }));
    await assert.rejects(service.sync(id, 'gate'), { code: 'CONFIGURATION_ERROR', status: 503 });
    assert.equal(calls.at(-1)?.name, 'bloom_calendar_fail_sync');
  } finally { if (saved === undefined) delete process.env.CALENDAR_ENCRYPTION_KEY; else process.env.CALENDAR_ENCRYPTION_KEY = saved; }
});
