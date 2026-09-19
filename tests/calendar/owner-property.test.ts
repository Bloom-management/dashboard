import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownerPropertyCalendarService } from '../../src/server/calendar/owner-property';
import { CalendarError } from '../../src/server/calendar/errors';
import { protectUrl } from '../../src/server/calendar/secrets';
import type { Rpc } from '../../src/server/calendar/store';

const source = { id: 'source', propertyId: 'property', provider: 'airbnb', enabled: true, lastSuccessAt: null, lastAttemptAt: null, errorCode: null, action: null };
const result = { runId: 'run', created: 0, updated: 0, removed: 0, unchanged: 0, conflicts: 0, status: 'success' };
test('owner add/list allowlist response and use owner-specific property-bound RPCs', async () => {
  process.env.CALENDAR_ENCRYPTION_KEY = 'a'.repeat(64);
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc: Rpc = async <T>(name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return (name.endsWith('_sources') ? { items: [{ ...source, encryptedUrl: 'private', fingerprint: 'private' }], nextCursor: null } : source) as T;
  };
  const service = ownerPropertyCalendarService('property', 'verified-owner', rpc);
  const row = await service.add('https://www.airbnb.com/calendar/ical/123.ics?t=synthetic', 'key');
  assert.deepEqual(Object.keys(row).sort(), ['id','propertyId','provider','enabled','lastSuccessAt','lastAttemptAt','message'].sort());
  assert.deepEqual(calls.map(c => c.name), ['bloom_owner_calendar_sources', 'bloom_owner_calendar_add_source']);
  assert(calls.every(c => c.args.p_actor === 'verified-owner' && c.args.p_property === 'property'));
  assert.equal((calls[1].args.p_input as { provider: string }).provider, 'airbnb');
});
test('owner sync carries property and verified actor through begin and finish', async () => {
  process.env.CALENDAR_ENCRYPTION_KEY = 'a'.repeat(64);
  const encrypted = protectUrl('https://www.airbnb.com/calendar/ical/123.ics?t=synthetic', 'airbnb', 'property');
  const calls: string[] = [];
  const rpc: Rpc = async <T>(name: string, args: Record<string, unknown>) => {
    assert.equal(args.p_property, 'property'); assert.equal(args.p_actor, 'verified-owner'); calls.push(name);
    if (name.endsWith('_sources')) return { items: [source], nextCursor: null } as T;
    if (name.endsWith('_begin_sync')) return { runId: 'run', version: 1, source: { ...source, ...encrypted, timezone: 'America/Detroit', syncVersion: 1 } } as T;
    return result as T;
  };
  const service = ownerPropertyCalendarService('property', 'verified-owner', rpc, async () => ({ status: 200, body: 'BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR' }));
  assert.deepEqual(await service.sync('source', 'key'), result);
  assert.deepEqual(calls, ['bloom_owner_calendar_sources', 'bloom_owner_calendar_sources', 'bloom_owner_calendar_begin_sync', 'bloom_owner_calendar_finish_sync']);
});
test('revoked owner failure is not bypassed and foreign source is rejected before fetching', async () => {
  const denied: Rpc = async () => { throw new CalendarError('FORBIDDEN', 403); };
  await assert.rejects(ownerPropertyCalendarService('property', 'owner', denied).list(), { code: 'FORBIDDEN' });
  const foreign: Rpc = async <T>() => ({ items: [{ ...source, propertyId: 'other' }], nextCursor: null }) as T;
  await assert.rejects(ownerPropertyCalendarService('property', 'owner', foreign).sync('source', 'key'), { code: 'NOT_FOUND' });
});

test('fetch failure bookkeeping also binds current owner and property without hiding authorization failure', async () => {
  process.env.CALENDAR_ENCRYPTION_KEY = 'a'.repeat(64);
  const encrypted = protectUrl('https://www.airbnb.com/calendar/ical/123.ics?t=synthetic', 'airbnb', 'property');
  let failureChecked = false;
  const rpc: Rpc = async <T>(name: string, args: Record<string, unknown>) => {
    assert.equal(args.p_property, 'property'); assert.equal(args.p_actor, 'verified-owner');
    if (name.endsWith('_sources')) return { items: [source], nextCursor: null } as T;
    if (name.endsWith('_begin_sync')) return { runId: 'run', version: 1, source: { ...source, ...encrypted, timezone: 'America/Detroit', syncVersion: 1 } } as T;
    if (name.endsWith('_fail_sync')) { failureChecked = true; assert.equal(args.p_source, 'source'); assert.equal(args.p_code, 'FETCH_FAILED'); return undefined as T; }
    throw new Error('unexpected RPC');
  };
  const service = ownerPropertyCalendarService('property', 'verified-owner', rpc, async () => { throw new CalendarError('FETCH_FAILED', 502); });
  await assert.rejects(service.sync('source', 'key'), { code: 'FETCH_FAILED' });
  assert.equal(failureChecked, true);
});

test('Vrbo source can request an owner-scoped sync receipt', async () => {
 const result={status:'not_modified',created:0,updated:0,removed:0,unchanged:0,conflicts:0};
 const rpc:Rpc=async <T>(name:string,args:Record<string,unknown>)=>{
  assert.equal(args.p_actor,'owner');assert.equal(args.p_property,'property');
  if(name==='bloom_owner_calendar_sources')return {items:[{...source,provider:'vrbo'}],nextCursor:null} as T;
  assert.equal(name,'bloom_owner_calendar_begin_sync');return {result} as T;
 };
 const service=ownerPropertyCalendarService('property','owner',rpc);
 assert.deepEqual(await service.sync('source','key'),result);
});

test('unexpected unsupported-provider lease is refused before decryption or fetch', async () => {
  const rpc: Rpc = async <T>(name: string) => {
    if (name.endsWith('_sources')) return { items: [source], nextCursor: null } as T;
    assert.equal(name, 'bloom_owner_calendar_begin_sync');
    return { runId: 'run', version: 1, source: { ...source, provider: 'unsupported', encryptedUrl: 'must-not-decrypt' } } as T;
  };
  const service = ownerPropertyCalendarService('property', 'owner', rpc, async () => { throw new Error('must not fetch'); });
  await assert.rejects(service.sync('source', 'key'), { code: 'NOT_FOUND' });
});
